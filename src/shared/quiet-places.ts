/**
 * Quiet places: where a Resident does not want to be seen precisely (home, work).
 *
 * Inside a quiet place, during the quiet schedule, or while "Quiet now" is on, the app applies a
 * quiet action instead of the user's normal area size:
 *  - `blur` (default): stay visible, but only at the coarsest area (Regional, ~50 km). A coarse dot
 *    blends in; vanishing every evening from the same 1 km square would outline the home instead.
 *  - `hide`: leave Nearby, remove the map dot and stop radio discovery. Contacts stay reachable.
 *
 * Quiet places are kept only on the device and never published. Places use the device's own GPS,
 * so they apply to Residents; "Quiet now" and the schedule apply to everyone.
 */
export type QuietAction = 'blur' | 'hide';

export type QuietPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  action: QuietAction;
};

export type QuietSchedule = {
  enabled: boolean;
  /** Local wall-clock "HH:MM"; a window may cross midnight (22:00 → 07:00). */
  start: string;
  end: string;
  action: QuietAction;
};

export type QuietSettings = {
  version: 1;
  places: QuietPlace[];
  quietNow: boolean;
  quietNowAction: QuietAction;
  schedule: QuietSchedule;
};

export type QuietState =
  | { active: false }
  | { active: true; action: QuietAction; reason: 'quiet-now' | 'schedule' | 'place'; placeName?: string };

export const QUIET_PLACE_RADII = [200, 500, 1_000, 2_000] as const;
export const DEFAULT_QUIET_RADIUS_METERS = 500;
export const MAX_QUIET_PLACES = 8;

export function defaultQuietSettings(): QuietSettings {
  return {
    version: 1,
    places: [],
    quietNow: false,
    quietNowAction: 'blur',
    schedule: { enabled: false, start: '22:00', end: '07:00', action: 'blur' },
  };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isAction = (value: unknown): value is QuietAction => value === 'blur' || value === 'hide';

/** Accept only well-formed values; anything else falls back to the default. */
export function normalizeQuietSettings(value: unknown): QuietSettings {
  const base = defaultQuietSettings();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<QuietSettings>;
  const places = Array.isArray(raw.places) ? raw.places : [];
  const schedule = (raw.schedule ?? {}) as Partial<QuietSchedule>;
  return {
    version: 1,
    places: places
      .filter((place): place is QuietPlace => !!place
        && typeof place.id === 'string' && place.id.length > 0
        && Number.isFinite(place.latitude) && Math.abs(place.latitude) <= 90
        && Number.isFinite(place.longitude) && Math.abs(place.longitude) <= 180
        && Number.isFinite(place.radiusMeters) && place.radiusMeters > 0 && place.radiusMeters <= 10_000
        && isAction(place.action))
      .slice(0, MAX_QUIET_PLACES)
      .map((place) => ({ ...place, name: String(place.name || '').slice(0, 40) })),
    quietNow: raw.quietNow === true,
    quietNowAction: isAction(raw.quietNowAction) ? raw.quietNowAction : base.quietNowAction,
    schedule: {
      enabled: schedule.enabled === true,
      start: typeof schedule.start === 'string' && TIME.test(schedule.start) ? schedule.start : base.schedule.start,
      end: typeof schedule.end === 'string' && TIME.test(schedule.end) ? schedule.end : base.schedule.end,
      action: isAction(schedule.action) ? schedule.action : base.schedule.action,
    },
  };
}

function minutes(clock: string): number {
  const [hours, mins] = clock.split(':').map(Number);
  return hours! * 60 + mins!;
}

export function scheduleIsActive(schedule: QuietSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  if (start === end) return false;
  const current = now.getHours() * 60 + now.getMinutes();
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function metersBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const radians = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * radians;
  const dLon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Hide" wins over "blur" when several reasons apply at once. */
function strongest(states: QuietState[]): QuietState {
  const active = states.filter((state): state is Extract<QuietState, { active: true }> => state.active);
  return active.find((state) => state.action === 'hide') ?? active[0] ?? { active: false };
}

/**
 * Which quiet action applies now. `residentLocation` is the device's own GPS fix, or null for a
 * Traveler (a chosen point is never "at home").
 */
export function quietStateFor(
  settings: QuietSettings,
  residentLocation: { latitude: number; longitude: number } | null,
  now: Date = new Date(),
): QuietState {
  const states: QuietState[] = [];
  if (settings.quietNow) states.push({ active: true, action: settings.quietNowAction, reason: 'quiet-now' });
  if (scheduleIsActive(settings.schedule, now)) states.push({ active: true, action: settings.schedule.action, reason: 'schedule' });
  if (residentLocation) {
    for (const place of settings.places) {
      if (metersBetween(residentLocation, place) <= place.radiusMeters) {
        states.push({ active: true, action: place.action, reason: 'place', placeName: place.name });
      }
    }
  }
  return strongest(states);
}
