import {
  isEmbeddedNativeOrigin,
  prepareDirectGunBrowserStorage,
  startGunLocalStorageSizeGuard,
} from '../../web/services/web-gun-service';

describe('embedded native Gun browser-storage policy', () => {
  it.each([
    ['Android loopback', { hostname: '127.0.0.1', port: '8088' }],
    ['desktop loopback', { hostname: 'localhost', port: '19161' }],
  ])('recognizes %s as an embedded native origin', (_label, locationLike) => {
    expect(isEmbeddedNativeOrigin(locationLike)).toBe(true);
  });

  it.each([
    ['development web server', { hostname: '127.0.0.1', port: '3001' }],
    ['remote production site', { hostname: 'www.iinpublic.com', port: '443' }],
  ])('does not treat %s as an embedded native origin', (_label, locationLike) => {
    expect(isEmbeddedNativeOrigin(locationLike)).toBe(false);
  });

  // Gun's own localStorage cache is load-bearing: disabling it stops `.map().on()` from ever
  // firing for newly-written children under a mapped path (including a client's own writes),
  // which silently broke every live multi-user feature built on it (chatroom rosters, presence).
  // Confirmed via e2e — see prepareDirectGunBrowserStorage's doc comment. It is re-enabled
  // everywhere; only a size guard (below) prevents the unbounded-growth quota crash this cache
  // caused before.
  it('enables Gun localStorage persistence for native shells', () => {
    const storage = { getItem: jest.fn(() => null), removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(
      { hostname: '127.0.0.1', port: '8088' },
      storage,
    )).toBe(true);
  });

  it('enables Gun localStorage persistence for ordinary browser origins', () => {
    const storage = { getItem: jest.fn(() => null), removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(
      { hostname: 'www.iinpublic.com', port: '443' },
      storage,
    )).toBe(true);
  });

  it('leaves a small existing cache alone', () => {
    const storage = { getItem: jest.fn(() => 'small-graph'), removeItem: jest.fn() };

    prepareDirectGunBrowserStorage({ hostname: 'www.iinpublic.com', port: '443' }, storage);

    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('clears an existing cache that has already grown past the safe ceiling', () => {
    const oversized = 'x'.repeat(3 * 1024 * 1024 + 1);
    const storage = { getItem: jest.fn(() => oversized), removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(undefined, storage)).toBe(true);
    expect(storage.removeItem).toHaveBeenCalledWith('gun/');
  });

  it('still enables persistence if the size check itself throws', () => {
    const storage = {
      getItem: jest.fn(() => { throw new Error('quota backend unavailable'); }),
      removeItem: jest.fn(),
    };

    expect(prepareDirectGunBrowserStorage(
      { hostname: 'localhost', port: '19161' },
      storage,
    )).toBe(true);
  });

  it('enables persistence even with no location info at all', () => {
    const storage = { getItem: jest.fn(() => null), removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(undefined, storage)).toBe(true);
  });
});

describe('startGunLocalStorageSizeGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('periodically clears the cache once it grows past the safe ceiling', () => {
    const oversized = 'x'.repeat(3 * 1024 * 1024 + 1);
    const storage = { getItem: jest.fn(() => oversized), removeItem: jest.fn() };

    startGunLocalStorageSizeGuard(storage, 1000);
    expect(storage.removeItem).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(storage.removeItem).toHaveBeenCalledWith('gun/');
  });

  it('does not clear a cache that stays under the ceiling', () => {
    const storage = { getItem: jest.fn(() => 'small'), removeItem: jest.fn() };

    startGunLocalStorageSizeGuard(storage, 1000);
    jest.advanceTimersByTime(5000);

    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('returns a stop function that halts further checks', () => {
    const oversized = 'x'.repeat(3 * 1024 * 1024 + 1);
    const storage = { getItem: jest.fn(() => oversized), removeItem: jest.fn() };

    const stop = startGunLocalStorageSizeGuard(storage, 1000);
    stop();
    jest.advanceTimersByTime(5000);

    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('is a no-op when no storage is available', () => {
    expect(() => startGunLocalStorageSizeGuard(undefined, 1000)).not.toThrow();
  });
});
