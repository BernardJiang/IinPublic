import { broadcastTagSlugFromLabel } from '../../shared/broadcast-tag-catalog';

/**
 * Counts broadcast preamble tag picks (one bump per slug per bulk register POST).
 */
export class BroadcastTagPopularityStore {
  private counts = new Map<string, number>();

  /** Called once when `register-receivers-for-broadcast` includes non-empty targeting tags */
  recordFromTargetTags(tagStrings: readonly string[]): void {
    const seen = new Set<string>();
    for (const raw of tagStrings) {
      const slug = broadcastTagSlugFromLabel(String(raw));
      if (!slug) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      this.counts.set(slug, (this.counts.get(slug) ?? 0) + 1);
    }
  }

  /** Descending count, stable id tiebreaker */
  getSnapshot(): Array<{ id: string; count: number }> {
    return [...this.counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  }

  resetForTesting(): void {
    this.counts.clear();
  }
}
