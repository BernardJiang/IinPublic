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

export class GraphLinkBridge {
  private running = false;
  private readonly opened = new Set<string>();
  private readonly opening = new Map<string, Promise<boolean>>();
  private readonly heard = new Map<string, string[]>();
  private flushScheduled = false;

  constructor(private readonly options: {
    core: CoreRequester;
    mesh: () => GraphLinkMesh | null;
    keys: (userId: string) => Promise<{ pub: string; epub: string } | null>;
    onEvent: (event: GraphEvent) => void;
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

  stop(): void { this.running = false; }

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
          if (!keys?.pub || !keys.epub) return false;
          await this.options.core({ name: 'graph.open', peerUserId: userId, pub: keys.pub, epub: keys.epub });
          this.opened.add(userId);
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

  /** A direct neighbor's link dropped. */
  close(userId: string): void {
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

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const { out, events } = await this.options.core({ name: 'graph.pull', waitMs: 20_000 });
        const mesh = this.options.mesh();
        for (const { to, raw } of out) {
          if (!mesh) continue;
          if (this.opened.has(to)) { void mesh.sendGraphGun(to, raw).catch(() => false); continue; }
          // The core writes its first reads (their head, the catch-up) while `graph.open` is still
          // running, before this side marks the link open. Dropping them lost the subscription,
          // and Gun never asks again: the other person's answers were never read (e2e mass/02).
          const pending = this.opening.get(to);
          if (pending) void pending.then((ok) => { if (ok) void this.options.mesh()?.sendGraphGun(to, raw).catch(() => false); });
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
