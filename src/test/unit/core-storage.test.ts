/** @jest-environment jsdom */
/** OPEN-91: smaller app data in the device core behind localStorage-style calls. */
import { appStorage } from '../../web/services/core-storage';
import { appDataView } from '../../web/services/core-views';

describe('appStorage', () => {
  beforeEach(() => localStorage.clear());

  it('keeps values in the core, never in localStorage', () => {
    appStorage.setItem('peerNameCache', '{"u1":"Ann"}');
    expect(appStorage.getItem('peerNameCache')).toBe('{"u1":"Ann"}');
    expect(localStorage.getItem('peerNameCache')).toBeNull();
    expect(appDataView.get('peerNameCache')).toBe('{"u1":"Ann"}');
    appStorage.removeItem('peerNameCache');
    expect(appStorage.getItem('peerNameCache')).toBeNull();
  });

  it('a localStorage value is newer (an older app, a test seed): taken into the core and removed', () => {
    appStorage.setItem('iinpublic_talk_intake_filters', '{"old":true}');
    localStorage.setItem('iinpublic_talk_intake_filters', '{"seeded":true}');
    expect(appStorage.getItem('iinpublic_talk_intake_filters')).toBe('{"seeded":true}');
    expect(localStorage.getItem('iinpublic_talk_intake_filters')).toBeNull();
    expect(appStorage.getItem('iinpublic_talk_intake_filters')).toBe('{"seeded":true}');
  });
});
