/**
 * One distance unit for the whole app (km or miles), chosen in Settings → Appearance. The default
 * follows the browser locale: miles for the US, the UK, Liberia and Myanmar, km everywhere else.
 * Stored values keep their own units (e.g. a Talk's `locationRadiusMiles`); only display converts.
 */
export type DistanceUnit = 'km' | 'mi';

const KEY = 'iinpublic_distance_unit';
const METERS_PER_MILE = 1_609.344;
const MILE_REGIONS = new Set(['US', 'GB', 'LR', 'MM']);

export function defaultDistanceUnit(locale: string = typeof navigator !== 'undefined' ? navigator.language : 'en'): DistanceUnit {
  const region = String(locale || '').split(/[-_]/)[1]?.toUpperCase();
  return region && MILE_REGIONS.has(region) ? 'mi' : 'km';
}

export function getDistanceUnit(): DistanceUnit {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'km' || saved === 'mi') return saved;
  } catch { /* storage blocked */ }
  return defaultDistanceUnit();
}

export function setDistanceUnit(unit: DistanceUnit): void {
  try {
    localStorage.setItem(KEY, unit);
  } catch { /* storage blocked: applies to this session only */ }
}

function trimmed(value: number): string {
  if (value < 10) return String(Math.round(value * 10) / 10);
  return Math.round(value).toLocaleString('en-US');
}

/** "400 m" / "1.2 km" / "16 km" or "0.2 mi" / "10 mi" in the chosen unit. */
export function formatDistance(meters: number, unit: DistanceUnit = getDistanceUnit()): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (unit === 'mi') {
    const miles = meters / METERS_PER_MILE;
    return miles < 0.1 ? '<0.1 mi' : `${trimmed(miles)} mi`;
  }
  return meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${trimmed(meters / 1_000)} km`;
}

export const milesToMeters = (miles: number): number => miles * METERS_PER_MILE;
export const metersToMiles = (meters: number): number => meters / METERS_PER_MILE;

/** Radius choices for a Talk's location question, as stored miles plus a label in the chosen unit. */
export function talkRadiusOptions(unit: DistanceUnit = getDistanceUnit()): Array<{ miles: number; label: string }> {
  const tiers = [10, 100, 1_000];
  return tiers.map((tier) => {
    const miles = unit === 'mi' ? tier : Math.round(metersToMiles(tier * 1_000) * 1_000) / 1_000;
    return { miles, label: `${tier.toLocaleString('en-US')} ${unit}` };
  });
}
