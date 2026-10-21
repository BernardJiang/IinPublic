import type { GPSCoordinate } from '../../shared/types';
import { readNativeHostInfo } from '../ui/native-host-info';
import { loadConnectivitySettings, saveConnectivitySettings, type LocationSource } from '../ui/connectivity-settings';
import { CHATROOM_MAP_LOCATIONS } from '../../shared/chatroom-map-locations';
import { LocationPrivacy } from '../../shared/location';

/**
 * Encounter location (TODO OPEN-40 P1): the point a Traveler ✈ appears at — chosen on the map (it
 * may be fictional) or, until then, random. It stays on this device; only the Nearby room derived
 * from it — a blurred, signed presence — is ever published. Every device asks for its real location
 * first (phones via the OS, the website and desktop app via the browser prompt); without it the
 * device is a Traveler at this point (OPEN-53).
 */
export const ENCOUNTER_LOCATION_KEY = 'iinpublic_encounter_location_v1';
export const ENCOUNTER_LOCATION_EVENT = 'iinpublic-encounter-location-changed';
/** A pin is exact by construction; this keeps the ordinary Nearby split depth available. */
const ENCOUNTER_ACCURACY_METERS = 50;

export type EncounterLocation = {
  version: 1;
  latitude: number;
  longitude: number;
  setAt: string;
  /** Placed at random because none was chosen yet; the user is asked to pick their own. */
  auto?: true;
};

/**
 * Dev/test builds give the website a fixed test location (`window.__test_location`, default San
 * Diego) that stands in for GPS; `'none'` simulates a GPS-less device. Production web has no GPS.
 */
function simulatedTestGps(): boolean {
  return process.env.NODE_ENV !== 'production'
    && typeof window !== 'undefined'
    && (window as { __test_location?: unknown }).__test_location !== 'none';
}

/**
 * Production website/desktop builds can ask the browser for the device location; the person grants
 * or denies it. Dev/test builds keep the injected test location instead (simulatedTestGps).
 */
function productionBrowserGeolocation(): boolean {
  return process.env.NODE_ENV === 'production'
    && typeof navigator !== 'undefined'
    && 'geolocation' in navigator;
}

/** The injected test fix (`window.__test_location`, default San Diego) for dev/test builds. */
export function testGpsLocation(): GPSCoordinate {
  const custom = (window as { __test_location?: { latitude: number; longitude: number; accuracy?: number } }).__test_location;
  return custom && typeof custom === 'object'
    ? { latitude: custom.latitude, longitude: custom.longitude, accuracy: custom.accuracy || 100, timestamp: new Date() }
    : { latitude: 32.7157, longitude: -117.1611, accuracy: 100, timestamp: new Date() };
}

/**
 * A fresh device fix. Dev/test websites answer with the injected test location, as at boot: the
 * browser's own geolocation there has no permission and times out after 10 s, which turned a
 * Resident back into a Traveler (OPEN-75). Phones always read their real GPS.
 */
export function readDeviceLocation(platform: string = readNativeHostInfo().platform): Promise<GPSCoordinate> {
  if (platform !== 'android' && platform !== 'ios' && simulatedTestGps()) return Promise.resolve(testGpsLocation());
  return LocationPrivacy.getCurrentLocation();
}

/** Phones read GPS; a production browser/desktop asks for location; dev/test builds simulate it. */
export function deviceHasGps(
  platform: string = readNativeHostInfo().platform,
  simulatedGps: boolean = simulatedTestGps(),
  browserGeolocation: boolean = productionBrowserGeolocation(),
): boolean {
  return platform === 'android' || platform === 'ios' || simulatedGps || browserGeolocation;
}

let gpsFixUnavailable = false;

/**
 * OPEN-53: a GPS-capable device whose fix was denied, failed or never arrived is a Traveler at its
 * encounter point (random until the person picks one) instead of dropping to Contacts only. A later
 * real fix clears this and the device becomes a Resident again.
 */
export function setGpsFixUnavailable(value: boolean): void {
  gpsFixUnavailable = value;
}

export function isGpsFixUnavailable(): boolean {
  return gpsFixUnavailable;
}

/** GeolocationPositionError.PERMISSION_DENIED, kept on the error by LocationPrivacy.getCurrentLocation. */
export function isLocationPermissionDenied(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 1;
}

/**
 * True when this device appears at a chosen point (a Traveler ✈) rather than its blurred GPS
 * (a Resident): on a device that cannot read location, when its owner chose "A point I choose",
 * and when no real fix is available (denied, failed or still pending).
 */
export function usesSelfDefinedEncounterLocation(
  platform: string = readNativeHostInfo().platform,
  source: LocationSource = loadConnectivitySettings().locationSource,
  simulatedGps: boolean = simulatedTestGps(),
  noGpsFix: boolean = gpsFixUnavailable,
): boolean {
  return !deviceHasGps(platform, simulatedGps) || source === 'traveler' || noGpsFix;
}

function validCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && typeof longitude === 'number'
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function getEncounterLocation(): EncounterLocation | null {
  try {
    const raw = localStorage.getItem(ENCOUNTER_LOCATION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<EncounterLocation>;
    if (value.version !== 1 || !validCoordinate(value.latitude, value.longitude)) return null;
    return {
      version: 1,
      latitude: value.latitude!,
      longitude: value.longitude!,
      setAt: String(value.setAt || ''),
      ...(value.auto === true ? { auto: true as const } : {}),
    };
  } catch {
    return null;
  }
}

export function setEncounterLocation(
  latitude: number,
  longitude: number,
  now: Date = new Date(),
  options: { auto?: boolean } = {},
): EncounterLocation {
  if (!validCoordinate(latitude, longitude)) throw new Error('encounter location is invalid');
  const value: EncounterLocation = {
    version: 1,
    latitude,
    longitude,
    setAt: now.toISOString(),
    ...(options.auto ? { auto: true as const } : {}),
  };
  try {
    localStorage.setItem(ENCOUNTER_LOCATION_KEY, JSON.stringify(value));
  } catch { /* storage blocked: the choice applies to this session only */ }
  window.dispatchEvent(new CustomEvent(ENCOUNTER_LOCATION_EVENT, { detail: value }));
  return value;
}

/**
 * A device without GPS that never chose a point still appears on the map: at a random built-in
 * city, a few km off its centre, as a Traveler (it is one by construction). Marked `auto` so the
 * UI keeps asking the person to pick their own.
 */
export function assignRandomEncounterLocation(random: () => number = Math.random, now: Date = new Date()): EncounterLocation {
  const cities = Object.values(CHATROOM_MAP_LOCATIONS);
  const city = cities[Math.min(cities.length - 1, Math.floor(random() * cities.length))]!;
  const jitter = () => (random() - 0.5) * 0.1;
  const latitude = Math.max(-85, Math.min(85, city.latitude + jitter()));
  const longitude = Math.max(-180, Math.min(180, city.longitude + jitter()));
  return setEncounterLocation(latitude, longitude, now, { auto: true });
}

const BROWSER_LOCATION_ASK_MIGRATION_KEY = 'iinpublic_browser_location_ask_v1';

/**
 * Before the website and desktop app could ask for location, a point picked there was the person's
 * only option. Run once: keep such a deliberate point as a Traveler choice instead of re-asking. A
 * random (auto) point is not a choice, so that device is asked for its location like a new one.
 */
export function keepEarlierBrowserEncounterChoice(platform: string = readNativeHostInfo().platform): void {
  try {
    if (localStorage.getItem(BROWSER_LOCATION_ASK_MIGRATION_KEY)) return;
    localStorage.setItem(BROWSER_LOCATION_ASK_MIGRATION_KEY, '1');
    if (platform === 'android' || platform === 'ios') return;
    const chosen = getEncounterLocation();
    if (!chosen || chosen.auto) return;
    const settings = loadConnectivitySettings();
    if (settings.locationSource !== 'traveler') saveConnectivitySettings({ ...settings, locationSource: 'traveler' });
  } catch { /* storage blocked: nothing to migrate */ }
}

export function clearEncounterLocation(): void {
  try {
    localStorage.removeItem(ENCOUNTER_LOCATION_KEY);
  } catch { /* storage blocked */ }
  window.dispatchEvent(new CustomEvent(ENCOUNTER_LOCATION_EVENT, { detail: null }));
}

export function encounterLocationCoordinate(value: Pick<EncounterLocation, 'latitude' | 'longitude'>): GPSCoordinate {
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    accuracy: ENCOUNTER_ACCURACY_METERS,
    timestamp: new Date(),
  };
}
