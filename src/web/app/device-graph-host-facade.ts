import type { CoreRequest } from '../../core/protocol';
import type { GraphConversationMessage, GraphTabSnapshot } from '../../core/device-graph/sync/graph-host';
import type { CoreRequester } from '../services/node-core-link';

export interface TalkStatsView {
  responses: number;
  matches: number;
  ignores: number;
}

export interface DeviceGraphHostFacadePorts {
  applyTabSnapshot(snapshot: GraphTabSnapshot): void;
  log?(message: string, error?: unknown): void;
  repeatGapMs?: number;
}

/** Stable web-host access to the optional device core and its live read projections. */
export class DeviceGraphHostFacade {
  private requester: CoreRequester | null = null;
  private tabRefresh: Promise<void> | null = null;
  private tabRefreshAgain = false;
  private statsGeneration = 0;

  constructor(private readonly ports: DeviceGraphHostFacadePorts) {}

  connect(requester: CoreRequester | null): void {
    this.requester = requester;
    this.statsGeneration += 1;
  }

  current(): CoreRequester | null {
    return this.requester;
  }

  async writeDelivery(request: Extract<CoreRequest, { name: 'delivery.putSentResponse' | 'delivery.record' }>): Promise<void> {
    const requester = this.requester;
    if (!requester) {
      this.ports.log?.(`[delivery] device core unavailable, not stored: ${request.name}`);
      return;
    }
    try { await requester(request); }
    catch (error) { this.ports.log?.(`[delivery] device core write failed: ${request.name}`, error); }
  }

  async conversationMessages(conversationId: string, limit = 200): Promise<GraphConversationMessage[]> {
    const requester = this.requester;
    if (!requester) return [];
    try { return await requester({ name: 'graph.conversationMessages', conversationId, limit }); }
    catch (error) { this.ports.log?.('[graph] conversation history read failed', error); return []; }
  }

  async deletedAt(talkId: string): Promise<number | null> {
    const requester = this.requester;
    if (!requester) return null;
    try { return await requester({ name: 'graph.deletedAt', talkId }); }
    catch (error) { this.ports.log?.('[graph] retraction read failed', error); return null; }
  }

  async talkStats(talkIds: string[]): Promise<Record<string, TalkStatsView> | null> {
    if (talkIds.length === 0) return {};
    const requester = this.requester;
    const generation = ++this.statsGeneration;
    let outcomes: Record<string, Record<string, string>> = {};
    if (requester) {
      try { outcomes = await requester({ name: 'graph.outcomes', talkIds }); }
      catch (error) { this.ports.log?.('[graph] Talk stats read failed', error); }
    }
    if (generation !== this.statsGeneration) return null;
    return Object.fromEntries(talkIds.map((talkId) => {
      const rows = Object.values(outcomes[talkId] ?? {});
      return [talkId, {
        responses: rows.length,
        matches: rows.filter((outcome) => outcome === 'matched').length,
        ignores: rows.filter((outcome) => outcome === 'ignored').length,
      }];
    }));
  }

  refreshTabSnapshot(): Promise<void> {
    if (this.tabRefresh) {
      this.tabRefreshAgain = true;
      return this.tabRefresh;
    }
    const requester = this.requester;
    if (!requester) return Promise.resolve();
    const refresh = (async () => {
      do {
        this.tabRefreshAgain = false;
        try {
          this.ports.applyTabSnapshot(await requester({ name: 'graph.tabSnapshot' }));
        } catch (error) {
          this.ports.log?.('[graph] tab projection refresh failed', error);
        }
        if (this.tabRefreshAgain) {
          await new Promise((resolve) => setTimeout(resolve, this.ports.repeatGapMs ?? 50));
        }
      } while (this.tabRefreshAgain);
    })().finally(() => {
      if (this.tabRefresh === refresh) this.tabRefresh = null;
    });
    this.tabRefresh = refresh;
    return refresh;
  }
}
