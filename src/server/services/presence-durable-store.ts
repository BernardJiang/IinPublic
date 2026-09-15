import Gun from 'gun';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';

/**
 * Keyed by PORT so parallel Playwright workers (each its own server on 8080+N — see
 * tests/e2e/helpers/ports.ts's parallelSlot()) never share a data directory — same convention
 * as TechSupportDurableStore's defaultDataDir().
 */
function defaultDataDir(): string {
  const port = process.env.PORT || '8080';
  return path.join(process.cwd(), `presence-radata-${port}`);
}

export type PresenceMember = {
  userId: string;
  stageName: string;
  isActive: boolean;
  joinedAt: string;
  lastSeen: string;
  epub?: string;
  pub?: string;
};

/**
 * Durable, Gun-native storage for chatroom presence (docs/TODO.md — "browsers don't see the
 * Ubuntu/Windows apps as members" investigation, 2026-09-15).
 *
 * Same root cause TechSupportDurableStore.ts already documents and fixes for its own channel:
 * the relay's main Gun instance is permanently ephemeral (radisk:false, p2p-runtime.ts), and
 * `radisk:false` silently drops multi-level chained Gun writes — `chatrooms/<id>/users/<userId>`
 * is exactly that shape (4 levels deep). Confirmed live, 2026-09-15: a real Ubuntu app's own
 * room-join write to that path never reached the relay's graph at all (two direct reads,
 * ~30s apart, both empty), while the server's separate in-memory roster (`fastActiveMembers`,
 * ChatroomManager) still counted it active — so the REST API and the desktop apps (LAN-meshed
 * with each other via lan-gun-discovery.ts, independent of the relay) all agreed the member was
 * there, but browsers — which read the room roster by subscribing directly to
 * `chatrooms/<id>/users` on the relay's own Gun graph (WebChatroomService.subscribeToMembers),
 * with no other source of truth — never saw it, because the node they were subscribed to
 * genuinely never existed.
 *
 * This store is NOT a general "make the relay durable" fix — it exists to make ONLY chatroom
 * presence reliable, deliberately isolated (own Gun instance, own directory, `peers: []`) from
 * the relay's main graph so nothing else on the relay (talks, conversations, chatbot memory,
 * profiles — the actual growing, per-user content this app is built to keep off the server)
 * gains durability as a side effect. ChatroomManager writes here AND to the existing ephemeral
 * graph (unchanged — still what browsers' live `.map().on()` subscription reads), then a
 * periodic sweep re-asserts this store's active members back into that ephemeral graph — so a
 * write that silently failed to land the first time gets healed within one sweep interval
 * instead of the member staying invisible to every browser for the rest of the session.
 *
 * No TTL enforced BY this store on write — callers (ChatroomManager) already own staleness
 * policy (ROOM_MEMBERSHIP_TTL_SECONDS) for the in-memory/ephemeral-graph paths; `getActiveMembers`
 * here applies the same TTL on read so a durable record from a peer that quietly vanished
 * (killed app, cleared storage) doesn't get reasserted into the ephemeral graph forever.
 */
export class PresenceDurableStore {
  private gun: any;
  private readonly dataDir: string;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.gun = this.newGunInstance();
  }

  private newGunInstance(): any {
    return Gun({
      peers: [],
      axe: false,
      multicast: false,
      radisk: true,
      file: this.dataDir,
      localStorage: false,
    });
  }

  async upsertMember(chatroomId: string, member: PresenceMember): Promise<void> {
    await this.put(['chatrooms', chatroomId, 'users', member.userId], member);
  }

  async markLeft(chatroomId: string, userId: string, leftAt: string): Promise<void> {
    const existing = await this.get(['chatrooms', chatroomId, 'users', userId]);
    await this.put(['chatrooms', chatroomId, 'users', userId], {
      ...(existing || {}),
      userId,
      isActive: false,
      leftAt,
    });
  }

  /** Active, non-stale members for a room — the set the ephemeral-graph reconciliation sweep
   *  re-asserts. Mirrors ChatroomManager's own staleness window (ROOM_MEMBERSHIP_TTL_SECONDS). */
  async getActiveMembers(chatroomId: string, now = Date.now()): Promise<PresenceMember[]> {
    const raw = (await this.collectMap(['chatrooms', chatroomId, 'users'])) as PresenceMember[];
    return raw.filter((member) => {
      if (!member || member.isActive !== true || !member.userId) return false;
      const seenAt = Date.parse(String(member.lastSeen || member.joinedAt || ''));
      if (!Number.isFinite(seenAt)) return true;
      return now - seenAt <= (ROOM_MEMBERSHIP_TTL_SECONDS + 5) * 1000;
    });
  }

  /**
   * E2E test reset — same fix as TechSupportDurableStore.resetForTesting() (see that method's
   * own doc comment): replaces the live Gun instance with a fresh one over the wiped directory,
   * rather than mutating `_.graph` on the same instance, so a reused path's stale chain
   * reference can't resurrect old data or silently fail the next write.
   */
  async resetForTesting(): Promise<void> {
    try {
      fs.rmSync(this.dataDir, { recursive: true, force: true });
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch {
      /* best-effort — a stale test dir should never crash the reset endpoint */
    }
    this.gun = this.newGunInstance();
  }

  // ── Low-level Gun helpers (identical shape to TechSupportDurableStore's) ────────────────

  private put(pathSegs: string[], data: unknown): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      let ref: any = this.gun;
      for (const seg of pathSegs) ref = ref.get(seg);
      ref.put(data, (ack: { err?: string }) => {
        if (ack?.err) logger.warn({ path: pathSegs.join('/'), err: ack.err }, '[PresenceDurableStore] put ack error');
        finish();
      });
      setTimeout(finish, 2000);
    });
  }

  private get(pathSegs: string[]): Promise<Record<string, unknown> | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (value: Record<string, unknown> | null) => {
        if (done) return;
        done = true;
        resolve(value);
      };
      let ref: any = this.gun;
      for (const seg of pathSegs) ref = ref.get(seg);
      ref.once((data: unknown) => finish(stripGunMeta(data)));
      setTimeout(() => finish(null), 800);
    });
  }

  private collectMap(pathSegs: string[]): Promise<Record<string, unknown>[]> {
    return new Promise((resolve) => {
      const found = new Map<string, Record<string, unknown>>();
      let ref: any = this.gun;
      for (const seg of pathSegs) ref = ref.get(seg);
      const mapRef = ref.map();
      mapRef.on((data: unknown, key: string) => {
        if (!key || key.startsWith('_')) return;
        const clean = stripGunMeta(data);
        if (clean) found.set(key, clean);
        else found.delete(key);
      });
      setTimeout(() => {
        try {
          mapRef.off();
        } catch {
          /* ignore */
        }
        resolve(Array.from(found.values()));
      }, 600);
    });
  }
}

function stripGunMeta(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const { _, ...rest } = data as Record<string, unknown>;
  return rest;
}
