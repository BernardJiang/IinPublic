import { mapMatchCounts, type MapMatchExchange, type MapMatchSource, type MapMatchUpdate } from '../../shared/map-matches';

/**
 * Rebuildable GUI view, never a database. With a core source attached, only its supplied
 * snapshots/patches are authoritative. Hosts without a source may supply accepted live outcomes
 * as a session-only projection; this view never restores anything from browser storage.
 */
export class MapMatchView {
  private counts = new Map<string, number>();
  private liveExchanges = new Map<string, MapMatchExchange>();
  private unsubscribe: (() => void) | undefined;
  private generation = 0;
  private hasSource = false;

  constructor(private readonly publish: (counts: ReadonlyMap<string, number>) => void) {}

  setSource(source: MapMatchSource | null): void {
    this.reset();
    if (!source) return;
    const generation = this.generation;
    this.hasSource = true;
    try {
      this.unsubscribe = source.subscribe((update) => {
        if (generation !== this.generation) return;
        this.apply(update);
      });
    } catch (error) {
      this.reset();
      throw error;
    }
  }

  /** Called only after an outcome has been accepted by the app's matching/version checks. */
  observeExchange(exchange: MapMatchExchange): void {
    if (this.hasSource || !exchange.peerId || !exchange.talkId) return;
    const key = JSON.stringify([exchange.peerId, exchange.talkId, exchange.direction]);
    const previous = this.liveExchanges.get(key);
    if (previous?.revision !== undefined && exchange.revision !== undefined && exchange.revision < previous.revision) return;
    this.liveExchanges.set(key, { ...exchange });
    this.counts = mapMatchCounts(this.liveExchanges.values());
    this.publish(new Map(this.counts));
  }

  reset(): void {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.hasSource = false;
    this.liveExchanges.clear();
    this.counts.clear();
    this.publish(new Map());
  }

  private apply(update: MapMatchUpdate): void {
    if (update.type === 'snapshot') this.counts.clear();
    for (const [peerId, count] of Object.entries(update.counts)) {
      if (peerId && typeof count === 'number' && Number.isSafeInteger(count) && count > 0) this.counts.set(peerId, count);
      else this.counts.delete(peerId);
    }
    this.publish(new Map(this.counts));
  }
}
