/**
 * The GUI's half of graph links (OPEN-106 step 3): browsers have no WebRTC in workers, so the page
 * hosts each direct link and carries the device core's Gun messages over it as `graph-gun` frames.
 * One long-poll loop asks the core what to send and which events to show.
 *
 * A link opens when a direct neighbor connects and closes when it drops. Nothing is queued for a
 * person who is not connected (D2): the core keeps its log, and the other side reads it on connect.
 */
import type { CoreRequester } from './node-core-link';
import type { GraphEvent } from '../../core/device-graph/sync/graph-host';

export type GraphLinkMesh = {
  sendGraphGun(toUserId: string, raw: string): Promise<boolean>;
  liveNeighborIds(): string[];
};

/** How often frames the mesh refused are tried again, and for how long they wait at most. */
const GRAPH_LINK_RETRY_MS = 250;
const GRAPH_LINK_HOLD_MS = 10_000;
/**
 * A link to a connected neighbor whose keys are not known yet is opened again later: first after
 * this long, then doubling up to `GRAPH_LINK_KEYS_MAX_MS`, while they stay connected.
 */
export const GRAPH_LINK_KEYS_RETRY_MS = 1_000;
const GRAPH_LINK_KEYS_MAX_MS = 15_000;
const GRAPH_LINK_KEYS_ATTEMPTS = 12;

export class GraphLinkBridge {
  private running = false;
  private readonly opened = new Set<string>();
  private readonly opening = new Map<string, Promise<boolean>>();
  private readonly heard = new Map<string, string[]>();
  private flushScheduled = false;
  /** Frames the mesh refused for an open link, oldest first, and since when (see `hold`). */
  private readonly unsent = new Map<string, { since: number; raws: string[] }>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Neighbors whose link waits for their keys: the next try (see `openWhenKeysKnown`). */
  private readonly keysWait = new Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> }>();
  /** How many times each neighbor's link has waited for their keys since they connected. */
  private readonly keysTried = new Map<string, number>();

  constructor(private readonly options: {
    core: CoreRequester;
    mesh: () => GraphLinkMesh | null;
    keys: (userId: string) => Promise<{ pub: string; epub: string } | null>;
    onEvent: (event: GraphEvent) => void;
    /** A link opened, on connect or later (their keys arrived): offers waiting for it can go. */
    onOpened?: (userId: string) => void;
    log?: (message: string) => void;
  }) {}

  /** Set who I am in the core and start carrying links. Safe to call again. */
  async start(identity: { userId: string; pair: { pub: string; priv: string; epub: string; epriv: string } }): Promise<void> {
    await this.options.core({ name: 'graph.identity', userId: identity.userId, pair: identity.pair });
    if (!this.running) {
      this.running = true;
      void this.loop();
    }
    for (const userId of this.options.mesh()?.liveNeighborIds() ?? []) void this.open(userId);
  }

  stop(): void {
    this.running = false;
    this.unsent.clear();
    for (const userId of [...this.keysWait.keys()]) this.clearKeysWait(userId);
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  isRunning(): boolean { return this.running; }

  /** A direct neighbor connected. */
  open(userId: string): Promise<boolean> {
    if (!this.running) return Promise.resolve(false);
    if (this.opened.has(userId)) return Promise.resolve(true);
    let pending = this.opening.get(userId);
    if (!pending) {
      pending = (async () => {
        try {
          const keys = await this.options.keys(userId);
          if (!keys?.pub || !keys.epub) {
            this.openWhenKeysKnown(userId);
            return false;
          }
          await this.options.core({ name: 'graph.open', peerUserId: userId, pub: keys.pub, epub: keys.epub });
          this.opened.add(userId);
          this.clearKeysWait(userId);
          try { this.options.onOpened?.(userId); } catch { /* the app's follow-up must not undo the open */ }
          return true;
        } catch (error) {
          this.options.log?.(`[graph-link] open ${userId.slice(0, 8)} failed: ${(error as Error).message}`);
          return false;
        } finally {
          this.opening.delete(userId);
        }
      })();
      this.opening.set(userId, pending);
    }
    return pending;
  }

  /**
   * A neighbor connected before their keys could be found (their public record had not reached the
   * hub yet, and Nearby v3's hub keeps no roster to read them from). The link was never tried
   * again: a Talk offered to them waited in my log for as long as the connection lasted, and they
   * never read it (native-app/12 on every phone, 2026-11-08). Try again with backoff while they
   * stay connected.
   */
  private openWhenKeysKnown(userId: string): void {
    if (!this.running || this.keysWait.has(userId)) return;
    const attempt = (this.keysTried.get(userId) ?? 0) + 1;
    if (attempt > GRAPH_LINK_KEYS_ATTEMPTS) return;
    this.keysTried.set(userId, attempt);
    if (attempt === 1) this.options.log?.(`[graph-link] no keys yet for ${userId.slice(0, 8)}: trying again while connected`);
    const delay = Math.min(GRAPH_LINK_KEYS_RETRY_MS * 2 ** (attempt - 1), GRAPH_LINK_KEYS_MAX_MS);
    const timer = setTimeout(() => {
      this.keysWait.delete(userId);
      if (!this.running || this.opened.has(userId)) return;
      if (!(this.options.mesh()?.liveNeighborIds() ?? []).includes(userId)) { this.keysTried.delete(userId); return; }
      void this.open(userId);
    }, delay);
    this.keysWait.set(userId, { attempt, timer });
  }

  private clearKeysWait(userId: string): void {
    const wait = this.keysWait.get(userId);
    if (wait) clearTimeout(wait.timer);
    this.keysWait.delete(userId);
    this.keysTried.delete(userId);
  }

  /** A direct neighbor's link dropped. */
  close(userId: string): void {
    this.unsent.delete(userId);
    this.clearKeysWait(userId);
    if (!this.opened.delete(userId)) return;
    void this.options.core({ name: 'graph.close', peerUserId: userId }).catch(() => undefined);
  }

  /** A `graph-gun` frame arrived: hand it to the core (batched per tick, opened first if needed). */
  hear(fromUserId: string, raw: string): void {
    if (!this.running) return;
    const list = this.heard.get(fromUserId) ?? [];
    list.push(raw);
    this.heard.set(fromUserId, list);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    setTimeout(() => { this.flushScheduled = false; void this.flushHeard(); }, 0);
  }

  private async flushHeard(): Promise<void> {
    const batches = [...this.heard.entries()];
    this.heard.clear();
    for (const [userId, raws] of batches) {
      if (!(await this.open(userId))) continue;
      await this.options.core({ name: 'graph.hear', peerUserId: userId, raws }).catch((error) => {
        this.options.log?.(`[graph-link] hear from ${userId.slice(0, 8)} failed: ${(error as Error).message}`);
      });
    }
  }

  /** Sends one frame; one the mesh refuses is held and tried again (`hold`). Order is kept. */
  private send(to: string, raw: string): void {
    const held = this.unsent.get(to);
    if (held) { held.raws.push(raw); return; }
    const mesh = this.options.mesh();
    if (!mesh) return;
    void mesh.sendGraphGun(to, raw).then((ok) => { if (!ok) this.hold(to, raw); }, () => this.hold(to, raw));
  }

  /**
   * A link opens on the first frame heard from someone, which can come before my mesh can send to
   * them (their new connection is not live here yet). The mesh refuses those frames, and what they
   * carried — my head, the answers to their reads — was lost for good: Gun sends a write once, and
   * the person stayed owed an answer after reconnecting (e2e 05-mailbox). Refused frames wait while
   * the link is open, up to `GRAPH_LINK_HOLD_MS`; after that the next link's catch-up covers them.
   */
  private hold(to: string, raw: string): void {
    if (!this.running || (!this.opened.has(to) && !this.opening.has(to))) return;
    const held = this.unsent.get(to);
    if (held) held.raws.push(raw);
    else this.unsent.set(to, { since: Date.now(), raws: [raw] });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.retryTimer || !this.unsent.size) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.retryHeld(); }, GRAPH_LINK_RETRY_MS);
  }

  private async retryHeld(): Promise<void> {
    for (const [to, held] of [...this.unsent]) {
      if ((!this.opened.has(to) && !this.opening.has(to)) || Date.now() - held.since > GRAPH_LINK_HOLD_MS) { this.unsent.delete(to); continue; }
      const mesh = this.options.mesh();
      while (mesh && held.raws.length) {
        if (!(await mesh.sendGraphGun(to, held.raws[0]).catch(() => false))) break;
        held.raws.shift();
      }
      if (!held.raws.length && this.unsent.get(to) === held) this.unsent.delete(to);
    }
    this.scheduleRetry();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const { out, events } = await this.options.core({ name: 'graph.pull', waitMs: 20_000 });
        const mesh = this.options.mesh();
        for (const { to, raw } of out) {
          if (!mesh) continue;
          if (this.opened.has(to)) { this.send(to, raw); continue; }
          // The core writes its first reads (their head, the catch-up) while `graph.open` is still
          // running, before this side marks the link open. Dropping them lost the subscription,
          // and Gun never asks again: the other person's answers were never read (e2e mass/02).
          const pending = this.opening.get(to);
          if (pending) void pending.then((ok) => { if (ok) this.send(to, raw); });
        }
        for (const event of events) {
          try { this.options.onEvent(event); } catch (error) { this.options.log?.(`[graph-link] event handler failed: ${(error as Error).message}`); }
        }
      } catch (error) {
        const message = (error as Error).message || String(error);
        // The page is going away (or the worker retired): its core link will not come back.
        if (/bridge closed|terminated/i.test(message)) { this.running = false; return; }
        this.options.log?.(`[graph-link] pull failed: ${message}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }
}
