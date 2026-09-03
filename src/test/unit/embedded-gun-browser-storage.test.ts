import {
  isEmbeddedNativeOrigin,
  prepareDirectGunBrowserStorage,
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

  it('removes the redundant Gun graph cache and disables persistence for native shells', () => {
    const storage = { removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(
      { hostname: '127.0.0.1', port: '8088' },
      storage,
    )).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith('gun/');
  });

  it('also disables the unbounded cache for ordinary browser origins (no eviction, quota crashes the app)', () => {
    const storage = { removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(
      { hostname: 'www.iinpublic.com', port: '443' },
      storage,
    )).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith('gun/');
  });

  it('still disables persistence if legacy cache removal is unavailable', () => {
    const storage = { removeItem: jest.fn(() => { throw new Error('quota backend unavailable'); }) };

    expect(prepareDirectGunBrowserStorage(
      { hostname: 'localhost', port: '19161' },
      storage,
    )).toBe(false);
  });

  it('disables persistence even with no location info at all', () => {
    const storage = { removeItem: jest.fn() };

    expect(prepareDirectGunBrowserStorage(undefined, storage)).toBe(false);
    expect(storage.removeItem).toHaveBeenCalledWith('gun/');
  });
});
