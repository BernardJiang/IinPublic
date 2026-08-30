import type { GPSCoordinate } from '../../shared/types';

/**
 * Cache-first UI: the last real GPS fix, so a returning user's boot never waits on geolocation
 * (permission prompt latency, a slow fix, or a device with no GPS at all) — see index.ts's boot
 * sequence. Device-local, not user-scoped: location isn't tied to who's logged in, and this cache
 * is read before a user identity even exists yet on a fresh device.
 */
const CACHED_LOCATION_KEY = 'iinpublic_cached_location';

export function getCachedLocation(): GPSCoordinate | null {
  try {
    const raw = localStorage.getItem(CACHED_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.latitude !== 'number' || typeof parsed?.longitude !== 'number') return null;
    return {
      latitude: parsed.latitude,
      longitude: parsed.longitude,
      accuracy: typeof parsed.accuracy === 'number' ? parsed.accuracy : 100,
      timestamp: new Date(),
    };
  } catch {
    return null;
  }
}

export function setCachedLocation(location: GPSCoordinate): void {
  try {
    localStorage.setItem(
      CACHED_LOCATION_KEY,
      JSON.stringify({ latitude: location.latitude, longitude: location.longitude, accuracy: location.accuracy }),
    );
  } catch {
    /* best-effort cache — a write failure (private browsing, quota) just means next boot
       resolves location the slow way again, never a functional break */
  }
}
