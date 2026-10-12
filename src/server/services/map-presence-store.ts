import {
  MAP_PRESENCE_QUERY_LIMIT,
  boundsContain,
  densityCells,
  verifyMapPresence,
  type MapBounds,
  type MapDensityCell,
  type MapPresence,
  type MapPresenceDot,
} from '../../shared/map-presence';

/** Hard bound on remembered users; the oldest observation is dropped first. */
const MAX_ENTRIES = 200_000;

/**
 * In-memory index of signed map presences (shared/map-presence.ts). It stores only public snapped
 * points and forgets each one at its expiry. A userId stays bound to the first SEA key that holds
 * it while that record is live, so another key cannot move someone else's dot.
 */
export class MapPresenceStore {
  private readonly byUser = new Map<string, MapPresence>();

  clear(): void {
    this.byUser.clear();
  }

  async register(value: unknown, now = new Date()): Promise<{ accepted: true; withdrawn: boolean }> {
    const verification = await verifyMapPresence(value, now);
    if (!verification.ok) throw new Error(verification.reason);
    const record = verification.record;
    this.prune(now.getTime());
    const existing = this.byUser.get(record.userId);
    if (existing && existing.pub !== record.pub) throw new Error('map presence userId is held by another key');
    if (existing && Date.parse(existing.observedAt) > Date.parse(record.observedAt)) {
      return { accepted: true, withdrawn: existing.location === null };
    }
    this.byUser.delete(record.userId);
    if (record.location === null) return { accepted: true, withdrawn: true };
    this.byUser.set(record.userId, record);
    if (this.byUser.size > MAX_ENTRIES) {
      const oldest = this.byUser.keys().next().value as string | undefined;
      if (oldest) this.byUser.delete(oldest);
    }
    return { accepted: true, withdrawn: false };
  }

  /** A user's live public point, if they publish one (room positions for the room list). */
  pointOf(userId: string, now = new Date()): { latitude: number; longitude: number } | undefined {
    const record = this.byUser.get(userId);
    if (!record?.location || Date.parse(record.expiresAt) <= now.getTime()) return undefined;
    return { latitude: record.location.latitude, longitude: record.location.longitude };
  }

  /**
   * Dots for the view (at most `limit`; none when the view holds more), plus anonymous density
   * squares for every user in it, so the heat map is complete even when dots are not.
   */
  query(bounds: MapBounds, now = new Date(), limit = MAP_PRESENCE_QUERY_LIMIT): {
    dots: MapPresenceDot[];
    density: MapDensityCell[];
    truncated: boolean;
  } {
    this.prune(now.getTime());
    const inView: MapPresenceDot[] = [];
    for (const record of this.byUser.values()) {
      if (!record.location || Date.parse(record.expiresAt) <= now.getTime() || !boundsContain(bounds, record.location)) continue;
      inView.push({ userId: record.userId, traveler: record.traveler, ...record.location });
    }
    const truncated = inView.length > limit;
    return { dots: truncated ? [] : inView, density: densityCells(bounds, inView), truncated };
  }

  /** Every refresh re-inserts its user at the end, so the map is in expiry order: stop early. */
  private prune(nowMs: number): void {
    for (const [userId, record] of this.byUser) {
      if (Date.parse(record.expiresAt) > nowMs) break;
      this.byUser.delete(userId);
    }
  }
}
