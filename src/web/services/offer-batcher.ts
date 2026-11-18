/**
 * Offers made in the same moment go to the device core as one `graph.offerMany` (2026-11-16): a
 * newcomer's catch-up or a run of likes used to be one `graph.offer` request per Talk, each
 * waiting its turn for one of the WebView's 6 connections to the node. Each caller still gets its
 * own Talk's result (or error).
 */
import type { CoreRequest, GraphOfferRequest, GraphOfferResult } from '../../core/protocol';

type Waiter = { resolve: (result: GraphOfferResult) => void; reject: (error: Error) => void };

export type OfferBatcherOptions = {
  request: (request: CoreRequest) => Promise<any>;
  /** Offers per `graph.offerMany` (default 50): bounds one request's size and time. */
  maxPerRequest?: number;
  /** How long to gather offers before sending (default 0: the rest of this turn). */
  gatherMs?: number;
};

export class OfferBatcher {
  private queue: Array<{ offer: Omit<GraphOfferRequest, 'name'>; waiter: Waiter }> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: OfferBatcherOptions) {}

  offer(request: GraphOfferRequest): Promise<GraphOfferResult> {
    const { name: _name, ...offer } = request;
    return new Promise((resolve, reject) => {
      this.queue.push({ offer, waiter: { resolve, reject } });
      this.timer ??= setTimeout(() => this.flush(), this.options.gatherMs ?? 0);
    });
  }

  private flush(): void {
    this.timer = null;
    const items = this.queue.splice(0);
    const size = Math.max(1, this.options.maxPerRequest ?? 50);
    for (let i = 0; i < items.length; i += size) void this.send(items.slice(i, i + size));
  }

  private async send(items: Array<{ offer: Omit<GraphOfferRequest, 'name'>; waiter: Waiter }>): Promise<void> {
    try {
      const answer = await this.options.request({ name: 'graph.offerMany', offers: items.map((item) => item.offer) });
      const results: unknown[] = Array.isArray(answer?.results) ? answer.results : [];
      items.forEach((item, index) => {
        const result = results[index] as (GraphOfferResult & { error?: string }) | undefined;
        if (!result) item.waiter.reject(new Error('graph.offerMany gave no result for this offer'));
        else if (typeof result.error === 'string') item.waiter.reject(new Error(result.error));
        else item.waiter.resolve(result);
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      for (const item of items) item.waiter.reject(failure);
    }
  }
}
