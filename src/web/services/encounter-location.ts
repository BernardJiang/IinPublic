import type { GPSCoordinate } from '../../shared/types';
import { readNativeHostInfo } from '../ui/native-host-info';
import { loadConnectivitySettings, type LocationSource } from '../ui/connectivity-settings';
import { CHATROOM_MAP_LOCATIONS } from '../../shared/chatroom-map-locations';

/**
 * Web/desktop encounter location (TODO OPEN-40 P1). Outside the phone apps, automatic Nearby never
 * reads GPS: the user deliberately chooses a point on the map, and that point (which may be
 * fictional) is the only location stranger discovery uses. It stays on this device; only the
 * Nearby room derived from it — a blurred, signed presence — is ever published. Clearing it puts
 * the device back in Contacts only.
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

/** Only the phone apps can read GPS; production web/desktop always appears at a chosen point. */
export function deviceHasGps(
  platform: string = readNativeHostInfo().platform,
  simulatedGps: boolean = simulatedTestGps(),
): boolean {
  return platform === 'android' || platform === 'ios' || simulatedGps;
}

/**
 * True when this device appears at a chosen point (a Traveler ✈) rather than its blurred GPS
 * (a Resident): always on web/desktop, and on a phone whose owner chose "A point I choose".
 */
export function usesSelfDefinedEncounterLocation(
  platform: string = readNativeHostInfo().platform,
  source: LocationSource = loadConnectivitySettings().locationSource,
  simulatedGps: boolean = simulatedTestGps(),
): boolean {
  return !deviceHasGps(platform, simulatedGps) || source === 'traveler';
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
