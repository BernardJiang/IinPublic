/** @jest-environment jsdom */

import {
  clearEncounterLocation,
  ENCOUNTER_LOCATION_EVENT,
  ENCOUNTER_LOCATION_KEY,
  encounterLocationCoordinate,
  getEncounterLocation,
  setEncounterLocation,
  usesSelfDefinedEncounterLocation,
} from '../../web/services/encounter-location';
import { showEncounterLocationPicker } from '../../web/ui/encounter-location-picker';
import { deriveNearbyRoomAssignment } from '../../shared/nearby-rooms';

const t = (key: string) => key;
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe('encounter location storage', () => {
  beforeEach(() => localStorage.clear());

  it('phone shells use GPS; the website and desktop use a self-defined location', () => {
    expect(usesSelfDefinedEncounterLocation('web')).toBe(true);
    expect(usesSelfDefinedEncounterLocation('electron')).toBe(true);
    expect(usesSelfDefinedEncounterLocation('android')).toBe(false);
    expect(usesSelfDefinedEncounterLocation('ios')).toBe(false);
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

  it('resolves the shared Nearby room from the chosen point, with nothing raw in the room id', () => {
    const point = encounterLocationCoordinate({ latitude: 48.8584, longitude: 2.2945 });
    const assignment = deriveNearbyRoomAssignment({ location: point, mode: 'neighborhood', identity: 'user-1' });
    expect(assignment.roomId).toMatch(/^nearby_v1_/);
    expect(assignment.roomId).not.toContain('48.8');
    // Two web users who choose nearby points share the same room.
    const neighbor = deriveNearbyRoomAssignment({
      location: encounterLocationCoordinate({ latitude: 48.8585, longitude: 2.2946 }),
      mode: 'neighborhood',
      identity: 'user-2',
    });
    expect(neighbor.roomId).toBe(assignment.roomId);
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
