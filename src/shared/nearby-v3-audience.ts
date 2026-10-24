import type { NearbyCard, NearbyCardScope } from './nearby-v3-card';
import { isEstablishedBefore } from './nearby-v3-attestation';
import { compareNearbyRankKeys, nearbyRankKey, type NearbyRankKey } from './nearby-v3-ranking';
import { isPublicLocation, publicLocationContains, type PublicLocation } from './public-location';

/**
 * Which identities one viewer's Nearby or Place page is drawn from, and whether it pages
 * (docs/design/nearby-and-place-chatrooms.md §3.7 "Nearby and global headcounts" and "Beyond `C`",
 * OPEN-86 E1). With `A` other Nearby identities, `R` of them inside the viewer's selected blurred
 * area, and page size `C`:
 *
 * - `A <= C`: everyone is on the first and only page (`all`);
 * - `A > C`, `R <= C`: the nearest `C` worldwide, no next page (`nearest`) — the wider search is an
 *   index, never a pageable audience;
 * - `R > C`: only those `R`, page by page (`area`).
 *
 * A Place pages only when more than `C` other members are in it (`place`). Pure: the hub feeds it
 * the live leases' cards, tests feed it plain cards.
 */
export type NearbyAudienceMode = 'all' | 'nearest' | 'area' | 'place';

export type NearbyAudienceSummary = {
  mode: NearbyAudienceMode;
  /**
   * The header's `N`, always excluding the viewer: `min(A, max(C, R))` in Nearby; the Place's
   * occupancy minus the viewer in a Place (the room list and map icon show full occupancy).
   */
  nearby: number;
  /** The audience itself holds more than `C` other identities, so pages exist. */
  pageable: boolean;
  /** Another eligible identity remains after the page just returned. */
  hasMore: boolean;
  /** The viewer's selected blurred area in Nearby; null in a Place. */
  area: PublicLocation | null;
};

export type NearbyAudiencePage = NearbyAudienceSummary & { cards: NearbyCard[] };

/** Extra cards past `C`, so a client whose rank keys differ slightly still fills its page. */
export const NEARBY_AUDIENCE_PAGE_SLACK = 32;

export function selectNearbyAudience(input: {
  viewer: { pub: string; point: PublicLocation; scope: NearbyCardScope };
  /** One live card per other count key in the viewer's scope (the viewer excluded). */
  others: readonly NearbyCard[];
  capacity: number;
  /** The viewer's ranking beacon string (`nearbyBeaconString`). */
  beacon: string;
  /** Only the boundary of a pageable audience is honoured; group 1 when absent. */
  after?: NearbyRankKey | null;
  slack?: number;
  /** Heartbeats need only the counts: skip ranking and return no cards. */
  countsOnly?: boolean;
}): NearbyAudiencePage {
  const capacity = Math.max(1, Math.floor(input.capacity));
  const place = input.viewer.scope !== 'nearby';
  const others = input.others.filter((card) => card.pub !== input.viewer.pub && card.scope === input.viewer.scope);
  let mode: NearbyAudienceMode;
  let pool: readonly NearbyCard[];
  let nearby: number;
  if (place) {
    mode = 'place';
    pool = others;
    nearby = others.length;
  } else {
    const inArea = others.filter((card) => publicLocationContains(input.viewer.point, card.point));
    nearby = Math.min(others.length, Math.max(capacity, inArea.length));
    if (others.length <= capacity) {
      mode = 'all';
      pool = others;
    } else if (inArea.length > capacity) {
      mode = 'area';
      pool = inArea;
    } else {
      mode = 'nearest';
      pool = others;
    }
  }
  const pageable = place ? pool.length > capacity : mode === 'area';
  const area = place ? null : { ...input.viewer.point };
  if (input.countsOnly) return { mode, nearby, pageable, hasMore: pageable, area, cards: [] };
  const beaconDay = beaconDayOf(input.beacon);
  const ranked = pool
    .map((card) => ({
      card,
      key: nearbyRankKey({
        viewerPub: input.viewer.pub,
        viewerPoint: input.viewer.point,
        memberPub: card.pub,
        memberPoint: place ? input.viewer.point : card.point,
        beacon: input.beacon,
        memberEstablished: !!beaconDay && isEstablishedBefore(card.age?.since, beaconDay),
      }),
    }))
    .sort((a, b) => compareNearbyRankKeys(a.key, b.key));
  const after = pageable ? input.after ?? null : null;
  const remaining = after ? ranked.filter((entry) => compareNearbyRankKeys(entry.key, after) > 0) : ranked;
  const slack = Math.max(0, Math.floor(input.slack ?? NEARBY_AUDIENCE_PAGE_SLACK));
  return {
    mode,
    nearby,
    pageable,
    hasMore: pageable && remaining.length > capacity,
    area,
    cards: remaining.slice(0, capacity + slack).map((entry) => entry.card),
  };
}

/**
 * Map colouring (§3.7 "Map, list and headcounts", OPEN-86 E3): is this live Nearby identity counted
 * by my audience although it may be on a later page? Everyone when `A <= C`; everyone inside my
 * selected area when it is crowded. The sparse nearest-`C` fallback counts only my page, so there
 * only the people on my list are green. In a Place, Nearby identities are never mine.
 */
export function isNearbyAudienceCandidate(
  audience: NearbyAudienceSummary | null,
  point: { latitude: number; longitude: number },
): boolean {
  if (!audience) return false;
  if (audience.mode === 'all') return true;
  return audience.mode === 'area' && !!audience.area && publicLocationContains(audience.area, point as PublicLocation);
}

/** The UTC day inside a beacon string (`beacon:<day>:<value>` or `utc-day:<day>`), or null. */
function beaconDayOf(beacon: string): string | null {
  return /^(?:beacon|utc-day):(\d{4}-\d{2}-\d{2})(?::|$)/.exec(beacon)?.[1] ?? null;
}

/** A wire summary (an introductions answer), shape-checked, or null. */
export function parseNearbyAudienceSummary(value: unknown): NearbyAudienceSummary | null {
  if (!value || typeof value !== 'object') return null;
  const summary = value as Partial<NearbyAudienceSummary>;
  if (summary.mode !== 'all' && summary.mode !== 'nearest' && summary.mode !== 'area' && summary.mode !== 'place') return null;
  if (!Number.isSafeInteger(summary.nearby) || summary.nearby! < 0) return null;
  if (typeof summary.pageable !== 'boolean' || typeof summary.hasMore !== 'boolean') return null;
  const area = summary.area === null || summary.area === undefined ? null : summary.area;
  if (area !== null && !isPublicLocation(area)) return null;
  return {
    mode: summary.mode,
    nearby: summary.nearby!,
    pageable: summary.pageable,
    hasMore: summary.pageable && summary.hasMore,
    area: area ? { ...area } : null,
  };
}
