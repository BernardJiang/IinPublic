/** @jest-environment jsdom */

import { renderLocationSection } from '../../web/ui/location-settings';
import { loadConnectivitySettings } from '../../web/ui/connectivity-settings';
import { LocationPrivacy } from '../../shared/location';
import { isLocationPermissionDenied } from '../../web/services/encounter-location';

// OPEN-54: a phone whose location was denied (or never asked) needs a way to ask the OS again.
describe('Settings → "Use my location"', () => {
  const render = (hasGps: boolean, gpsFixUnavailable: boolean) => {
    document.body.innerHTML = renderLocationSection({
      t: (key) => key,
      connectivity: loadConnectivitySettings(),
      hasGps,
      traveler: gpsFixUnavailable,
      gpsFixUnavailable,
      encounterBlock: '',
    });
    return document.querySelector('[data-testid="settings-use-my-location"]');
  };

  it('is offered when a GPS device has no fix', () => {
    expect(render(true, true)).not.toBeNull();
  });

  it('is not offered once a real fix is in hand', () => {
    expect(render(true, false)).toBeNull();
  });

  it('is not offered on a device that cannot share location at all', () => {
    expect(render(false, true)).toBeNull();
  });
});

// 2026-10-17 (native-app/35 on a P30): location turned off after a session that saved a real fix.
// The boot reused the saved fix, the denial was treated like a slow fix, and the phone stayed at
// its old position with no "Use my location". A denial must be told apart from other failures.
describe('a refused location request', () => {
  const geolocation = (navigator as unknown as { geolocation?: unknown }).geolocation;
  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
  });

  const failWith = async (code: number): Promise<unknown> => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (_ok: unknown, fail: (error: unknown) => void) => fail({ code, message: 'nope' }) },
    });
    return LocationPrivacy.getCurrentLocation().then(() => null, (error) => error);
  };

  it('is recognised as a denial, so the phone becomes a Traveler even with a saved fix', async () => {
    expect(isLocationPermissionDenied(await failWith(1))).toBe(true);
  });

  it('is not confused with a timeout or an unavailable fix', async () => {
    expect(isLocationPermissionDenied(await failWith(3))).toBe(false);
    expect(isLocationPermissionDenied(await failWith(2))).toBe(false);
    expect(isLocationPermissionDenied(new Error('other'))).toBe(false);
  });
});
