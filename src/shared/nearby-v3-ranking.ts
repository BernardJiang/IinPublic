import { portableSha256Hex } from './portable-sha256';

/**
 * How a viewer orders the people on their nearby list (§3.7 "Ranking"): nearer first, by the
 * distance between public points (people in the same square tie at 0), then the viewer's own hash
 * order `hash(viewer, member, daily beacon)`. The order is public on purpose: a gossip partner can
 * rank cards the way I would and send me exactly the ones I would keep.
 */
export type NearbyRankKey = { distanceMeters: number; tie: string };

const EARTH_RADIUS_METERS = 6_371_000;

export function publicPointDistanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  if (a.latitude === b.latitude && a.longitude === b.longitude) return 0;
  const toRadians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRadians;
  const dLng = (b.longitude - a.longitude) * toRadians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * toRadians) * Math.cos(b.latitude * toRadians) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * The value every viewer mixes into their order for one day, so a key ground to rank first for one
 * victim stops working the next day. Until the signed manifest carries an unpredictable beacon
 * (OPEN-70), it is the UTC date: everyone agrees on it, but it can be predicted.
 */
export function nearbyDailyBeacon(now: Date | number = Date.now()): string {
  const day = new Date(typeof now === 'number' ? now : now.getTime()).toISOString().slice(0, 10);
  return `utc-day:${day}`;
}

export function nearbyRankTie(viewerPub: string, memberPub: string, beacon: string): string {
  return portableSha256Hex(`iinpublic:nearby-rank:v1:${beacon}:${viewerPub}:${memberPub}`).slice(0, 16);
}

export function nearbyRankKey(input: {
  viewerPub: string;
  viewerPoint: { latitude: number; longitude: number };
  memberPub: string;
  memberPoint: { latitude: number; longitude: number };
  beacon: string;
}): NearbyRankKey {
  return {
    distanceMeters: publicPointDistanceMeters(input.viewerPoint, input.memberPoint),
    tie: nearbyRankTie(input.viewerPub, input.memberPub, input.beacon),
  };
}

export function compareNearbyRankKeys(a: NearbyRankKey, b: NearbyRankKey): number {
  if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
  return a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0;
}
