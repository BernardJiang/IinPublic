import Gun from 'gun';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger';
import { MAILBOX_MAX_CIPHERTEXT_BYTES, type MailboxEnvelope, type StoreEnvelopeResult } from './mailbox-store';
import type { TechSupportStoredMessage } from './techsupport-message-store';

/**
 * Keyed by PORT so parallel Playwright workers (each its own server on 8080+N — see
 * tests/e2e/helpers/ports.ts's parallelSlot()) never share a data directory. This store stays
 * radisk:true unconditionally, including under E2E_GUN_MEMORY_ONLY=1: that flag keeps the main
 * relay graph memory-only to dodge cross-worker disk races, but forcing this store's own writes
 * to radisk:false would reintroduce the exact silent-write bug it exists to avoid (see class doc
 * below). Per-worker directories plus the explicit reset in index.ts's onClearDatabase callback
 * (wired to POST /api/test/clear-database, which every E2E spec already calls between tests) is
 * what keeps disk-based tests isolated instead.
 */
function defaultDataDir(): string {
  const port = process.env.PORT || '8080';
  return path.join(process.cwd(), `techsupport-radata-${port}`);
}

/** Abuse/disk-growth safety valve — NOT a "give up after N hours" policy. There is deliberately
 * no TTL here (see class doc below); this only bounds unbounded growth from spam. */
const MAX_MAILBOX_ENVELOPES = 1000;

/**
 * Durable, Gun-native storage for TechSupport's support channel.
 *
 * The relay's main Gun instance is permanently ephemeral (`src/shared/p2p-runtime.ts`'s
 * hardcoded `starServerPersistence: 'ephemeral'`, `radisk: false` always — dev, CI, and
 * production via render.yaml's RELAY_ONLY_HUB=1). That's a deliberate choice for ordinary
 * traffic: the relay is a stateless rendezvous point, and durability lives on each user's own
 * device (the browser's IndexedDB-backed Gun worker, `public/worker.js`; the mobile embedded
 * node's own `radisk:true` Gun instance, `attachGun()`'s embedded branch).
 *
 * TechSupport is documented as the one exception — "the only server-durable chat channel"
 * (spec §19.7) — because there is no fixed schedule for when an operator is online, so
 * questions have to accumulate on the relay itself rather than waiting for a peer. This class
 * is what actually makes that true: its own separate Gun instance, with real disk persistence
 * (`radisk: true`), isolated from the relay's ephemeral graph so nothing else on the relay
 * changes.
 *
 * Confirmed live (2026-09-02): the relay's ephemeral (`radisk:false`) config silently drops
 * multi-level chained Gun writes — `gun.get(a).get(b).get(c).put()`'s ack callback never fires,
 * the data never reaches `gun._.graph`, and any read on that path burns its full timeout. The
 * exact same write, same isolation (`peers:[]`, `axe:false`), succeeds in under 300ms with only
 * `radisk:true` changed. This store exists to use Gun the way it actually works here, not to
 * paper over that bug with an unrelated persistence mechanism (a JSON file, SQLite, etc.).
 *
 * No TTL on the mailbox side, by design: "no fixed schedule" means a question has to survive
 * however long the operator happens to be offline. `MAX_MAILBOX_ENVELOPES` only guards against
 * unbounded growth from abuse (oldest evicted on overflow), not staleness.
 */
export class TechSupportDurableStore {
  private readonly gun: any;
  private readonly dataDir: string;

  constructor(dataDir: string = defaultDataDir()) {
    this.dataDir = dataDir;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.gun = Gun({
      peers: [],
      axe: false,
      multicast: false,
      radisk: true,
      file: this.dataDir,
      localStorage: false,
    });
  }

  // ── Support message thread (replaces TechSupportMessageStore) ──────────────

  async appendMessage(message: TechSupportStoredMessage): Promise<void> {
    await this.put(['techsupport', 'messages', message.conversationId, message.id], message);
  }

  async listMessages(conversationId: string): Promise<TechSupportStoredMessage[]> {
    const raw = (await this.collectMap(['techsupport', 'messages', conversationId])) as TechSupportStoredMessage[];
    return raw.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // ── Durable support mailbox (replaces MailboxStore, TechSupport recipient only) ────────────

  async store(params: {
    id: string;
    recipientId: string;
    ciphertext: string;
    ttlMs?: number;
  }): Promise<StoreEnvelopeResult> {
    const { id, recipientId, ciphertext } = params;
    if (!id) return { stored: false, reason: 'id is required' };
    if (!recipientId) return { stored: false, reason: 'recipientId is required' };
    if (!ciphertext) return { stored: false, reason: 'ciphertext is required' };
    if (Buffer.byteLength(ciphertext, 'utf8') > MAILBOX_MAX_CIPHERTEXT_BYTES) {
      return { stored: false, reason: `ciphertext exceeds ${MAILBOX_MAX_CIPHERTEXT_BYTES} byte limit` };
    }

    const existing = (await this.get(['techsupport', 'mailbox', id])) as MailboxEnvelope | null;
    if (existing) return { stored: true, envelope: existing };

    const envelopes = (await this.collectMap(['techsupport', 'mailbox'])) as MailboxEnvelope[];
    if (envelopes.length >= MAX_MAILBOX_ENVELOPES) {
      const oldest = [...envelopes].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )[0];
      if (oldest) await this.remove(['techsupport', 'mailbox', oldest.id]);
    }

    const now = new Date();
    // No real expiry — durable until drained. expiresAt is kept far in the future only so this
    // still satisfies MailboxEnvelope's shape for any caller that reads the field.
    const envelope: MailboxEnvelope = {
      id,
      recipientId,
      ciphertext,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 1000 * 60 * 60 * 24 * 365 * 10).toISOString(),
    };
    await this.put(['techsupport', 'mailbox', id], envelope);
    return { stored: true, envelope };
  }

  async list(_recipientId: string): Promise<MailboxEnvelope[]> {
    return (await this.collectMap(['techsupport', 'mailbox'])) as MailboxEnvelope[];
  }

  async delete(_recipientId: string, envelopeId: string): Promise<boolean> {
    const existing = await this.get(['techsupport', 'mailbox', envelopeId]);
    if (!existing) return false;
    await this.remove(['techsupport', 'mailbox', envelopeId]);
    return true;
  }

  /** No-op — this store has no TTL to sweep. Kept for interface parity with MailboxStore. */
  pruneExpired(): void {}

  async getTotalCount(): Promise<number> {
    return (await this.collectMap(['techsupport', 'mailbox'])).length;
  }

  async getQueueSizes(): Promise<Record<string, number>> {
    const envelopes = (await this.collectMap(['techsupport', 'mailbox'])) as MailboxEnvelope[];
    return envelopes.length ? { [envelopes[0].recipientId]: envelopes.length } : {};
  }

  /** E2E test reset: clears the in-memory graph AND the on-disk radisk directory. */
  async resetForTesting(): Promise<void> {
    if (this.gun?._?.graph) this.gun._.graph = {};
    try {
      fs.rmSync(this.dataDir, { recursive: true, force: true });
      fs.mkdirSync(this.dataDir, { recursive: true });
    } catch {
      /* best-effort — a stale test dir should never crash the reset endpoint */
    }
  }

  // ── Low-level Gun helpers ───────────────────────────────────────────────────────────────

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
        if (ack?.err) logger.warn({ path: pathSegs.join('/'), err: ack.err }, '[TechSupportDurableStore] put ack error');
        finish();
      });
      // radisk writes ack reliably in practice (confirmed) — this is a guard against a wedged
      // write hanging the request indefinitely, not the expected path.
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

  private remove(pathSegs: string[]): Promise<void> {
    return this.put(pathSegs, null);
  }

  /**
   * Bounded sweep of a Gun map's children — `.map()` has no "done" signal, so this collects for
   * a fixed window and returns whatever arrived, mirroring the pattern chatroom-manager.ts
   * already uses for the same reason (subscribeToMembers's `mapRef.on(...)` + `setTimeout`).
   */
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
