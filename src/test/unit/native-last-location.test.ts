/**
 * Android's own location fallback (found 2026-10-20 on the Huawei P30): the WebView's geolocation
 * never answered while the phone's GPS had a 5 m fix, so the page stayed at a random point.
 */
import { LocationPrivacy, nativeLastLocation } from '../../shared/location';

type Global = { IinPublicNearby?: { lastLocation?: () => string } | undefined; navigator?: unknown };
const g = globalThis as unknown as Global;
const NOW = Date.parse('2026-10-20T21:00:00Z');

function withBridge(fix: object | '', run: () => Promise<void> | void) {
  const previous = g.IinPublicNearby;
  g.IinPublicNearby = { lastLocation: () => (fix ? JSON.stringify(fix) : '') };
  return Promise.resolve(run()).finally(() => { g.IinPublicNearby = previous; });
}

describe('nativeLastLocation', () => {
  it('returns a recent platform fix and ignores old, malformed or missing ones', async () => {
    await withBridge({ latitude: 32.9, longitude: -117.2, accuracy: 5, timeMs: NOW - 30_000 }, () => {
      expect(nativeLastLocation(60_000, NOW)).toMatchObject({ latitude: 32.9, longitude: -117.2, accuracy: 5 });
      expect(nativeLastLocation(10_000, NOW)).toBeNull();
    });
    await withBridge({ latitude: 200, longitude: 0, timeMs: NOW }, () => { expect(nativeLastLocation(60_000, NOW)).toBeNull(); });
    await withBridge('', () => { expect(nativeLastLocation(60_000, NOW)).toBeNull(); });
    expect(nativeLastLocation(60_000, NOW)).toBeNull();
  });
});

describe('LocationPrivacy.getCurrentLocation on Android', () => {
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setGeolocation = (impl: (ok: (p: unknown) => void, fail: (e: unknown) => void) => void) => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { geolocation: { getCurrentPosition: impl } } });
  };
  afterEach(() => {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
  });

  it('falls back to the platform fix when the WebView times out', async () => {
    setGeolocation((_ok, fail) => fail({ code: 3, message: 'Timeout expired' }));
    await withBridge({ latitude: 32.9, longitude: -117.2, accuracy: 5, timeMs: Date.now() - 10 * 60_000 }, async () => {
      await expect(LocationPrivacy.getCurrentLocation()).resolves.toMatchObject({ latitude: 32.9 });
    });
  });

  it('takes a fix hours old rather than none (indoors, no network location provider)', async () => {
    setGeolocation((_ok, fail) => fail({ code: 3, message: 'Timeout expired' }));
    await withBridge({ latitude: 32.9, longitude: -117.2, accuracy: 5, timeMs: Date.now() - 5 * 3_600_000 }, async () => {
      await expect(LocationPrivacy.getCurrentLocation()).resolves.toMatchObject({ latitude: 32.9 });
    });
  });

  it('still reports a denied permission as denied', async () => {
    setGeolocation((_ok, fail) => fail({ code: 1, message: 'denied' }));
    await withBridge({ latitude: 32.9, longitude: -117.2, accuracy: 5, timeMs: Date.now() - 10 * 60_000 }, async () => {
      await expect(LocationPrivacy.getCurrentLocation()).rejects.toMatchObject({ code: 1 });
    });
  });

  it('uses a fresh platform fix without waiting for the WebView', async () => {
    const asked = jest.fn();
    setGeolocation(asked);
    await withBridge({ latitude: 32.9, longitude: -117.2, accuracy: 5, timeMs: Date.now() - 5_000 }, async () => {
      await expect(LocationPrivacy.getCurrentLocation()).resolves.toMatchObject({ latitude: 32.9 });
    });
    expect(asked).not.toHaveBeenCalled();
  });
});
