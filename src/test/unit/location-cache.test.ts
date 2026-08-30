import { getCachedLocation, setCachedLocation } from '../../web/services/location-cache';

describe('location-cache (cache-first UI: boot never waits on geolocation)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing has been cached yet', () => {
    expect(getCachedLocation()).toBeNull();
  });

  it('round-trips a cached location', () => {
    setCachedLocation({ latitude: 37.7749, longitude: -122.4194, accuracy: 15, timestamp: new Date() });
    const cached = getCachedLocation();
    expect(cached).not.toBeNull();
    expect(cached?.latitude).toBe(37.7749);
    expect(cached?.longitude).toBe(-122.4194);
    expect(cached?.accuracy).toBe(15);
  });

  it('overwrites the previous cached location on a fresh fix', () => {
    setCachedLocation({ latitude: 1, longitude: 1, accuracy: 100, timestamp: new Date() });
    setCachedLocation({ latitude: 2, longitude: 2, accuracy: 50, timestamp: new Date() });
    const cached = getCachedLocation();
    expect(cached?.latitude).toBe(2);
    expect(cached?.longitude).toBe(2);
    expect(cached?.accuracy).toBe(50);
  });

  it('falls back to a default accuracy when the stored value omits it', () => {
    localStorage.setItem('iinpublic_cached_location', JSON.stringify({ latitude: 5, longitude: 6 }));
    const cached = getCachedLocation();
    expect(cached?.latitude).toBe(5);
    expect(cached?.longitude).toBe(6);
    expect(cached?.accuracy).toBe(100);
  });

  it('ignores malformed cached data rather than throwing', () => {
    localStorage.setItem('iinpublic_cached_location', 'not json');
    expect(getCachedLocation()).toBeNull();

    localStorage.setItem('iinpublic_cached_location', JSON.stringify({ latitude: 'oops' }));
    expect(getCachedLocation()).toBeNull();

    localStorage.setItem('iinpublic_cached_location', JSON.stringify({}));
    expect(getCachedLocation()).toBeNull();
  });

  it('a fresh Date is stamped on every read (never trusts a serialized timestamp)', () => {
    setCachedLocation({ latitude: 9, longitude: 9, accuracy: 10, timestamp: new Date('2020-01-01') });
    const before = Date.now();
    const cached = getCachedLocation();
    expect(cached?.timestamp.getTime()).toBeGreaterThanOrEqual(before);
  });
});
