import { broadcastTagSlugFromLabel } from '../../shared/broadcast-tag-catalog';

export type BroadcastTagTrendRow = { id: string; total: number; byDay: number[] };

export type BroadcastTagTrendSnapshot = { days: string[]; tags: BroadcastTagTrendRow[] };

/**
 * Counts broadcast preamble tag picks (one bump per slug per bulk register POST).
 */
export class BroadcastTagPopularityStore {
  private counts = new Map<string, number>();
  /** slug → UTC YYYY-MM-DD → bumps that day */
  private dayCounts = new Map<string, Map<string, number>>();

  private utcDayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private bumpDay(slug: string, dayKey: string): void {
    let m = this.dayCounts.get(slug);
    if (!m) {
      m = new Map();
      this.dayCounts.set(slug, m);
    }
    m.set(dayKey, (m.get(dayKey) ?? 0) + 1);
  }

  /** Called once when `register-receivers-for-broadcast` includes non-empty targeting tags */
  recordFromTargetTags(tagStrings: readonly string[]): void {
    const seen = new Set<string>();
    const dayKey = this.utcDayKey(new Date());
    for (const raw of tagStrings) {
      const slug = broadcastTagSlugFromLabel(String(raw));
      if (!slug) continue;
      if (seen.has(slug)) continue;
      seen.add(slug);
      this.counts.set(slug, (this.counts.get(slug) ?? 0) + 1);
      this.bumpDay(slug, dayKey);
    }
  }

  /** Descending count, stable id tiebreaker */
  getSnapshot(): Array<{ id: string; count: number }> {
    return [...this.counts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  }

  /** Last `lastNDays` UTC calendar days including today; `byDay` aligns with `days`. */
  getTrends(lastNDays: number): BroadcastTagTrendSnapshot {
    const n = Math.min(90, Math.max(1, Math.floor(lastNDays)));
    const now = new Date();
    const days: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
      days.push(d.toISOString().slice(0, 10));
    }
    const allSlugs = new Set<string>([...this.counts.keys(), ...this.dayCounts.keys()]);
    const tags: BroadcastTagTrendRow[] = [...allSlugs]
      .map((id) => {
        const dm = this.dayCounts.get(id);
        const byDay = days.map((dk) => dm?.get(dk) ?? 0);
        return { id, total: this.counts.get(id) ?? 0, byDay };
      })
      .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
    return { days, tags };
  }

  resetForTesting(): void {
    this.counts.clear();
    this.dayCounts.clear();
  }
}
