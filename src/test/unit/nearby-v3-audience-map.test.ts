/**
 * OPEN-86 E3: the map's people layer. The hub answers a city-sized view with bounded public-point
 * dots for live Nearby identities (never Place members), and the client colours each green when my
 * audience counts it — including people on later pages — or yellow otherwise.
 */
import { snapPublicLocation, type PublicLocation } from '../../shared/public-location';
import { NEARBY_V3_DEFAULTS } from '../../shared/nearby-v3-config';
import type { NearbyCard } from '../../shared/nearby-v3-card';
import { isNearbyAudienceCandidate, type NearbyAudienceSummary } from '../../shared/nearby-v3-audience';
import { MAX_MAP_DOTS, NearbyV3Hub } from '../../server/services/nearby-v3-hub';
import { groupUserDots } from '../../web/ui/chatroom-map-view';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const SD = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const LA = snapPublicLocation({ latitude: 34.0522, longitude: -118.2437 }, 1_000);
const SD_VIEW = { west: -117.4, south: 32.5, east: -116.9, north: 32.9 };

function card(pub: string, point: PublicLocation, scope: NearbyCard['scope'] = 'nearby'): NearbyCard {
  return {
    version: 1,
    kind: 'nearby-card',
    userId: `user-${pub}`,
    pub,
    countKey: pub,
    scopeRevision: NOW,
    point,
    traveler: false,
    scope,
    issuedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + NEARBY_V3_DEFAULTS.cardLifetimeMs).toISOString(),
    proof: { pub } as NearbyCard['proof'],
  };
}

describe('hub map dots (OPEN-86 E3)', () => {
  it('returns one public-point dot per live Nearby identity in a city view, and none for Place members', () => {
    const hub = new NearbyV3Hub({ ...NEARBY_V3_DEFAULTS, capacity: 3 }, NOW);
    for (let i = 0; i < 5; i += 1) hub.ingest(card(`sd${i}`, SD), NOW);
    hub.ingest(card('cafe', SD, 'place:cafe'), NOW);
    hub.ingest(card('la', LA), NOW);
    const stats = hub.stats(SD_VIEW, NOW);
    expect(stats.dots?.map((dot) => dot.userId).sort()).toEqual(['user-sd0', 'user-sd1', 'user-sd2', 'user-sd3', 'user-sd4']);
    expect(stats.dots?.every((dot) => dot.latitude === SD.latitude && dot.longitude === SD.longitude
      && dot.precisionMeters === SD.precisionMeters)).toBe(true);
    // Nothing beyond the public point: no keys, cards or proofs reach the map.
    expect(Object.keys(stats.dots![0]!).sort()).toEqual(['latitude', 'longitude', 'precisionMeters', 'traveler', 'userId']);
  });

  it('leaves wide views to the heat layer and bounds a dense city view', () => {
    const hub = new NearbyV3Hub(NEARBY_V3_DEFAULTS, NOW);
    for (let i = 0; i < MAX_MAP_DOTS + 5; i += 1) hub.ingest(card(`p${i}`, SD), NOW);
    expect(hub.stats({ west: -125, south: 30, east: -110, north: 40 }, NOW).dots).toBeUndefined();
    const dense = hub.stats(SD_VIEW, NOW);
    expect(dense.dots).toHaveLength(MAX_MAP_DOTS);
    expect(dense.dotsTruncated).toBe(true);
  });
});

describe('green and yellow dots (OPEN-86 E3)', () => {
  const summary = (mode: NearbyAudienceSummary['mode'], area: PublicLocation | null = SD): NearbyAudienceSummary =>
    ({ mode, nearby: 0, pageable: mode === 'area', hasMore: false, area });

  it('counts everyone when A <= C, my crowded area when it pages, and only my page otherwise', () => {
    expect(isNearbyAudienceCandidate(summary('all'), LA)).toBe(true);
    expect(isNearbyAudienceCandidate(summary('area'), SD)).toBe(true);
    expect(isNearbyAudienceCandidate(summary('area'), LA)).toBe(false);
    expect(isNearbyAudienceCandidate(summary('nearest'), SD)).toBe(false);
    expect(isNearbyAudienceCandidate(summary('place', null), SD)).toBe(false);
    expect(isNearbyAudienceCandidate(null, SD)).toBe(false);
  });

  it('colours later-page people in my crowded area green, people elsewhere yellow, and draws each person once', () => {
    const audience = summary('area');
    const dots = [
      { ...SD, userId: 'on-my-page', traveler: false },
      { ...SD, userId: 'later-page', traveler: false },
      { ...LA, userId: 'elsewhere', traveler: false },
      { ...SD, userId: 'on-my-page', traveler: false }, // also reported by the hub
      { ...SD, userId: 'me', traveler: false },
    ];
    const groups = groupUserDots({
      selfUserId: 'me',
      roomMemberIds: new Set(['on-my-page']),
      isCandidate: (dot) => isNearbyAudienceCandidate(audience, dot),
    }, dots);
    const green = groups.filter((group) => group.kind === 'room').flatMap((group) => group.userIds).sort();
    const yellow = groups.filter((group) => group.kind === 'other').flatMap((group) => group.userIds);
    expect(green).toEqual(['later-page', 'on-my-page']);
    expect(yellow).toEqual(['elsewhere']);
  });
});
