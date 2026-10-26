import { nearbyBasePrecisionMeters, isNearbyPublicMode, type NearbyPrivacyMode } from './nearby-rooms';

/**
 * The one place a device's location becomes something other people can see: the map dot,
 * `users/<id>/location`, and a Talk's `authorLocation` all use this snapped point.
 *
 * The exact fix never leaves the device. It is replaced by the centre of a grid square at least
 * PUBLIC_LOCATION_MIN_METERS wide (coarser when the user's privacy setting or GPS accuracy is
 * coarser), so everyone in one square publishes exactly the same point. A snapped point re-snaps
 * to itself, which lets a receiver reject any point that is not a grid centre.
 */
export const PUBLIC_LOCATION_MIN_METERS = 400;
/** Allowed public grid sizes. The selected size is also the viewer's exact Nearby area. */
export const PUBLIC_LOCATION_PRECISIONS = [400, 1_000, 10_000, 50_000] as const;
export type PublicLocationPrecision = (typeof PUBLIC_LOCATION_PRECISIONS)[number];

export type PublicLocation = {
  latitude: number;
  longitude: number;
  precisionMeters: PublicLocationPrecision;
};

const METERS_PER_DEGREE = 111_320;
const MAX_LATITUDE = 85;
const DECIMALS = 1e6;

/**
 * Grid size to publish for this privacy setting, or null when nothing may be published
 * (Contacts only, Location off). Poor GPS accuracy moves up to a coarser grid, never finer.
 */
export function publicLocationPrecisionMeters(
  mode: NearbyPrivacyMode,
  accuracyMeters?: number,
): PublicLocationPrecision | null {
  if (!isNearbyPublicMode(mode)) return null;
  const accuracyFloor = Number.isFinite(accuracyMeters) && accuracyMeters! > 0 ? accuracyMeters! * 2 : 0;
  const wanted = Math.max(PUBLIC_LOCATION_MIN_METERS, nearbyBasePrecisionMeters(mode), accuracyFloor);
  return PUBLIC_LOCATION_PRECISIONS.find((size) => size >= wanted) ?? PUBLIC_LOCATION_PRECISIONS.at(-1)!;
}

const round = (value: number) => Math.round(value * DECIMALS) / DECIMALS;

/**
 * Snap to the centre of the grid square containing `point`. Rows are `precision` metres of
 * latitude; each row's longitude step uses the row's centre latitude, so squares stay roughly
 * `precision` wide on the ground and the result is deterministic.
 */
export function snapPublicLocation(
  point: { latitude: number; longitude: number },
  precisionMeters: PublicLocationPrecision,
): PublicLocation {
  if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    throw new Error('public location needs finite coordinates');
  }
  const latitude = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, point.latitude));
  const longitude = ((((point.longitude + 180) % 360) + 360) % 360) - 180;
  const latStep = precisionMeters / METERS_PER_DEGREE;
  const row = Math.floor(latitude / latStep);
  const snappedLatitude = (row + 0.5) * latStep;
  const lonStep = Math.min(360, precisionMeters / (METERS_PER_DEGREE * Math.cos((snappedLatitude * Math.PI) / 180)));
  const column = Math.floor((longitude + 180) / lonStep);
  const snappedLongitude = -180 + (column + 0.5) * lonStep;
  return {
    latitude: round(snappedLatitude),
    longitude: round(Math.min(180, snappedLongitude)),
    precisionMeters,
  };
}

/** The point to publish for this device, or null when its setting publishes nothing. */
export function publicLocationFor(
  location: { latitude: number; longitude: number; accuracy?: number },
  mode: NearbyPrivacyMode,
): PublicLocation | null {
  const precision = publicLocationPrecisionMeters(mode, location.accuracy);
  return precision === null ? null : snapPublicLocation(location, precision);
}

/** Stay in the previous square until this far (as a share of the square) past its edge. */
export const PUBLIC_LOCATION_HYSTERESIS_RATIO = 0.15;

/**
 * Like `publicLocationFor`, but keeps the previously published square while the device is still
 * within 15% of a square beyond its edge. Without this, the instant a dot jumps to the next
 * square would reveal that its owner is right at that edge, and jitter there would repeat it.
 */
export function publicLocationWithHysteresis(
  location: { latitude: number; longitude: number; accuracy?: number },
  mode: NearbyPrivacyMode,
  previous: PublicLocation | null | undefined,
): PublicLocation | null {
  const next = publicLocationFor(location, mode);
  if (!next || !previous || previous.precisionMeters !== next.precisionMeters) return next;
  const latHalf = (previous.precisionMeters / METERS_PER_DEGREE) / 2;
  const lonHalf = Math.min(180, previous.precisionMeters / (METERS_PER_DEGREE * Math.cos((previous.latitude * Math.PI) / 180))) / 2;
  const slack = 1 + 2 * PUBLIC_LOCATION_HYSTERESIS_RATIO;
  const withinLatitude = Math.abs(location.latitude - previous.latitude) <= latHalf * slack;
  const longitudeGap = Math.abs(((((location.longitude - previous.longitude) + 540) % 360) - 180));
  return withinLatitude && longitudeGap <= lonHalf * slack ? previous : next;
}

/** True when `value` is exactly a grid centre at an allowed precision (what a sender must send). */
export function isPublicLocation(value: unknown): value is PublicLocation {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PublicLocation>;
  if (!PUBLIC_LOCATION_PRECISIONS.includes(candidate.precisionMeters as PublicLocationPrecision)
    || !Number.isFinite(candidate.latitude)
    || !Number.isFinite(candidate.longitude)
    || Math.abs(candidate.latitude!) > MAX_LATITUDE
    || Math.abs(candidate.longitude!) > 180) return false;
  const again = snapPublicLocation(candidate as PublicLocation, candidate.precisionMeters as PublicLocationPrecision);
  return again.latitude === candidate.latitude && again.longitude === candidate.longitude;
}

/** Geographic bounds of a published cell; longitude stays unwrapped for map rendering. */
export function publicLocationBounds(point: PublicLocation): { west: number; south: number; east: number; north: number } {
  const latHalf = point.precisionMeters / METERS_PER_DEGREE / 2;
  const lonHalf = Math.min(180, point.precisionMeters / (METERS_PER_DEGREE * Math.cos(point.latitude * Math.PI / 180))) / 2;
  return { west: point.longitude - lonHalf, south: point.latitude - latHalf, east: point.longitude + lonHalf, north: point.latitude + latHalf };
}

/**
 * Is another published point inside the viewer's selected blurred cell?
 *
 * Nearby is deliberately viewer-relative: the viewer's precision defines the rectangle while the
 * candidate contributes only its own already-blurred public point. Different precision choices can
 * therefore produce asymmetric answers. Longitude wraps across the antimeridian.
 */
export function publicLocationContains(viewer: PublicLocation, candidate: PublicLocation): boolean {
  const latHalf = (viewer.precisionMeters / METERS_PER_DEGREE) / 2;
  if (Math.abs(candidate.latitude - viewer.latitude) > latHalf) return false;
  const lonHalf = Math.min(
    180,
    viewer.precisionMeters / (METERS_PER_DEGREE * Math.cos((viewer.latitude * Math.PI) / 180)),
  ) / 2;
  const longitudeGap = Math.abs(((((candidate.longitude - viewer.longitude) + 540) % 360) - 180));
  return longitudeGap <= lonHalf;
}

const REGION_PATTERN = /^cell_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)_(\d+)$/;

/** `users/<id>/location.region` form of a public point. */
export function publicLocationRegion(location: PublicLocation): string {
  return `cell_${location.latitude}_${location.longitude}_${location.precisionMeters}`;
}

export function parsePublicLocationRegion(region: string): PublicLocation | null {
  const match = REGION_PATTERN.exec(String(region || ''));
  if (!match) return null;
  const candidate = { latitude: Number(match[1]), longitude: Number(match[2]), precisionMeters: Number(match[3]) };
  return isPublicLocation(candidate) ? candidate : null;
}
