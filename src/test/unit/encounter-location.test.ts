/** @jest-environment jsdom */

import {
  assignRandomEncounterLocation,
  clearEncounterLocation,
  ENCOUNTER_LOCATION_EVENT,
  ENCOUNTER_LOCATION_KEY,
  encounterLocationCoordinate,
  getEncounterLocation,
  setEncounterLocation,
  usesSelfDefinedEncounterLocation,
  isGpsFixUnavailable,
  setGpsFixUnavailable,
  deviceHasGps,
  keepEarlierBrowserEncounterChoice,
} from '../../web/services/encounter-location';
import { loadConnectivitySettings } from '../../web/ui/connectivity-settings';
import { showEncounterLocationPicker } from '../../web/ui/encounter-location-picker';
import { snapPublicLocation } from '../../shared/public-location';
import { CHATROOM_MAP_LOCATIONS } from '../../shared/chatroom-map-locations';

const t = (key: string) => key;
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('encounter location storage', () => {
  beforeEach(() => localStorage.clear());

  it('phone Residents use GPS; the website, desktop and phone Travelers use a chosen point', () => {
    expect(usesSelfDefinedEncounterLocation('web', 'resident', false)).toBe(true);
    expect(usesSelfDefinedEncounterLocation('electron', 'resident', false)).toBe(true);
    expect(usesSelfDefinedEncounterLocation('android', 'resident', false)).toBe(false);
    expect(usesSelfDefinedEncounterLocation('ios', 'resident', false)).toBe(false);
    expect(usesSelfDefinedEncounterLocation('android', 'traveler', false)).toBe(true);
    // Dev/test builds: the injected test location stands in for GPS on the website.
    expect(usesSelfDefinedEncounterLocation('web', 'resident', true)).toBe(false);
  });

  it('a phone Resident without a GPS fix is a Traveler until a real fix clears the flag (OPEN-53)', () => {
    expect(usesSelfDefinedEncounterLocation('android', 'resident', false, true)).toBe(true);
    setGpsFixUnavailable(true);
    try {
      expect(isGpsFixUnavailable()).toBe(true);
      expect(usesSelfDefinedEncounterLocation('android', 'resident', false)).toBe(true);
    } finally {
      setGpsFixUnavailable(false);
    }
    expect(usesSelfDefinedEncounterLocation('android', 'resident', false)).toBe(false);
  });

  it('a production browser or desktop can ask for location; without geolocation it cannot', () => {
    expect(deviceHasGps('web', false, true)).toBe(true);
    expect(deviceHasGps('electron', false, true)).toBe(true);
    expect(deviceHasGps('web', false, false)).toBe(false);
    expect(usesSelfDefinedEncounterLocation('web', 'resident', false, false)).toBe(true);
  });

  it('keeps a point picked before browsers could share location as a Traveler choice, once', () => {
    localStorage.clear();
    setEncounterLocation(48.85, 2.35);
    keepEarlierBrowserEncounterChoice('web');
    expect(loadConnectivitySettings().locationSource).toBe('traveler');
  });

  it('asks again when the earlier point was random, and never touches phones', () => {
    localStorage.clear();
    assignRandomEncounterLocation(() => 0.5);
    keepEarlierBrowserEncounterChoice('web');
    expect(loadConnectivitySettings().locationSource).toBe('resident');
    localStorage.clear();
    setEncounterLocation(48.85, 2.35);
    keepEarlierBrowserEncounterChoice('android');
    expect(loadConnectivitySettings().locationSource).toBe('resident');
  });

  it('places a location-less device near a built-in city, marked auto until the person picks', () => {
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener(ENCOUNTER_LOCATION_EVENT, listener);
    const placed = assignRandomEncounterLocation(() => 0.5, new Date('2026-10-11T00:00:00Z'));
    window.removeEventListener(ENCOUNTER_LOCATION_EVENT, listener);
    expect(placed.auto).toBe(true);
    expect(getEncounterLocation()).toEqual(placed);
    expect(events).toEqual([placed]);
    const city = Object.values(CHATROOM_MAP_LOCATIONS).some((c) =>
      Math.abs(c.latitude - placed.latitude) <= 0.05 && Math.abs(c.longitude - placed.longitude) <= 0.05);
    expect(city).toBe(true);
    // A deliberate pick replaces it and drops the auto mark.
    expect(setEncounterLocation(10, 20).auto).toBeUndefined();
    expect(getEncounterLocation()?.auto).toBeUndefined();
  });

  it('persists a deliberate (possibly fictional) point, announces it, and clears it', () => {
    const events: unknown[] = [];
    const listener = (event: Event) => events.push((event as CustomEvent).detail);
    window.addEventListener(ENCOUNTER_LOCATION_EVENT, listener);
    expect(getEncounterLocation()).toBeNull();
    const saved = setEncounterLocation(-77.85, 166.67, new Date('2026-10-10T00:00:00Z'));
    expect(getEncounterLocation()).toEqual(saved);
    expect(saved).toMatchObject({ version: 1, latitude: -77.85, longitude: 166.67, setAt: '2026-10-10T00:00:00.000Z' });
    clearEncounterLocation();
    expect(getEncounterLocation()).toBeNull();
    window.removeEventListener(ENCOUNTER_LOCATION_EVENT, listener);
    expect(events).toEqual([saved, null]);
  });

  it('rejects invalid points and ignores corrupt storage', () => {
    expect(() => setEncounterLocation(91, 0)).toThrow();
    expect(() => setEncounterLocation(0, Number.NaN)).toThrow();
    localStorage.setItem(ENCOUNTER_LOCATION_KEY, '{"version":1,"latitude":"x","longitude":2}');
    expect(getEncounterLocation()).toBeNull();
    localStorage.setItem(ENCOUNTER_LOCATION_KEY, 'not json');
    expect(getEncounterLocation()).toBeNull();
  });

  it('publishes the chosen point only snapped to the public grid, the same for close neighbours', () => {
    const point = snapPublicLocation(encounterLocationCoordinate({ latitude: 48.8584, longitude: 2.2945 }), 1_000);
    const neighbor = snapPublicLocation(encounterLocationCoordinate({ latitude: 48.8585, longitude: 2.2946 }), 1_000);
    expect(neighbor).toEqual(point);
    expect(point.latitude).not.toBe(48.8584);
  });
});

describe('encounter location picker', () => {
  afterEach(() => document.getElementById('encounter-location-modal')?.remove());

  it('works without the map: typed coordinates enable Confirm, and nothing is saved before it', async () => {
    const confirmed: unknown[] = [];
    showEncounterLocationPicker({ t: t as never, initial: null, onConfirm: (point) => confirmed.push(point), loadMap: () => Promise.reject(new Error('offline')) });
    await flush();
    expect(document.getElementById('encounter-location-map-error')!.textContent).toBe('encounterPickerMapFailed');
    const confirm = document.getElementById('encounter-location-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const lat = document.getElementById('encounter-location-lat') as HTMLInputElement;
    const lng = document.getElementById('encounter-location-lng') as HTMLInputElement;
    lat.value = '95';
    lng.value = '10';
    lat.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(true);
    lat.value = '35.6595';
    lat.dispatchEvent(new Event('input'));
    expect(confirm.disabled).toBe(false);
    expect(confirmed).toEqual([]);
    confirm.click();
    expect(confirmed).toEqual([{ latitude: 35.6595, longitude: 10 }]);
    expect(document.getElementById('encounter-location-modal')).toBeNull();
  });

  it('"Use my current location" only places the pin; it still requires confirmation', async () => {
    const confirmed: unknown[] = [];
    showEncounterLocationPicker({
      t: t as never,
      initial: null,
      onConfirm: (point) => confirmed.push(point),
      loadMap: () => Promise.reject(new Error('offline')),
      currentPosition: async () => ({ latitude: 40.7128, longitude: -74.006 }),
    });
    (document.getElementById('encounter-location-current') as HTMLButtonElement).click();
    await flush();
    expect((document.getElementById('encounter-location-lat') as HTMLInputElement).value).toBe('40.71280');
    expect(document.getElementById('encounter-location-map-status')!.textContent).toBe('encounterPickerCurrentHint');
    expect(confirmed).toEqual([]);
    (document.getElementById('encounter-location-cancel') as HTMLButtonElement).click();
    expect(confirmed).toEqual([]);
  });

  it('prefills the existing point and discloses the map tile provider', () => {
    showEncounterLocationPicker({ t: t as never, initial: { latitude: 1.5, longitude: 2.5 }, onConfirm: () => undefined, loadMap: () => new Promise(() => undefined) });
    expect((document.getElementById('encounter-location-lng') as HTMLInputElement).value).toBe('2.50000');
    expect(document.getElementById('encounter-location-modal')!.textContent).toContain('encounterPickerDisclosure');
  });
});
