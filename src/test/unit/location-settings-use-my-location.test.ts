/** @jest-environment jsdom */

import { renderLocationSection } from '../../web/ui/location-settings';
import { loadConnectivitySettings } from '../../web/ui/connectivity-settings';

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
