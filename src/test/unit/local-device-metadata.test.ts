import {
  LOCAL_DEVICE_METADATA_KEY,
  detectLocalDevicePlatform,
  formatIdentityFingerprint,
  getOrCreateLocalDeviceMetadata,
  readLocalDeviceMetadata,
  renameLocalDevice,
} from '../../web/services/local-device-metadata';

describe('local device metadata', () => {
  beforeEach(() => localStorage.clear());

  it('creates and reuses a privacy-minimized local record', () => {
    const created = getOrCreateLocalDeviceMetadata(localStorage, {
      name: 'This browser',
      platform: 'browser',
      createdAt: 1234,
    });
    const reused = getOrCreateLocalDeviceMetadata(localStorage, {
      name: 'Ignored replacement',
      platform: 'android',
      createdAt: 9999,
    });

    expect(reused).toEqual(created);
    expect(JSON.parse(localStorage.getItem(LOCAL_DEVICE_METADATA_KEY) || '{}')).toEqual({
      schemaVersion: 1,
      name: 'This browser',
      platform: 'browser',
      createdAt: 1234,
    });
    expect(localStorage.getItem(LOCAL_DEVICE_METADATA_KEY)).not.toMatch(/pub|key|hostname|serial|model/i);
  });

  it('normalizes renamed labels and rejects an empty name', () => {
    const metadata = getOrCreateLocalDeviceMetadata(localStorage, {
      name: 'This device',
      platform: 'browser',
      createdAt: 1234,
    });

    const renamed = renameLocalDevice(localStorage, metadata, '  Alice\n browser  ');
    expect(renamed.name).toBe('Alice browser');
    expect(readLocalDeviceMetadata(localStorage)?.name).toBe('Alice browser');
    expect(() => renameLocalDevice(localStorage, renamed, '   ')).toThrow('Device name is required');
  });

  it('uses only coarse platform classes', () => {
    expect(detectLocalDevicePlatform('android')).toBe('android');
    expect(detectLocalDevicePlatform('', 'Mozilla/5.0 (iPhone)')).toBe('ios');
    expect(detectLocalDevicePlatform('electron')).toBe('desktop');
    expect(detectLocalDevicePlatform('', 'Mozilla/5.0 Chrome')).toBe('browser');
    expect(detectLocalDevicePlatform('', 'Mozilla/5.0 (X11; Linux x86_64) Chrome')).toBe('browser');
  });

  it('formats a stable short fingerprint sampled across the full SEA public key', () => {
    const publicKey = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    const fingerprint = formatIdentityFingerprint(publicKey);
    expect(fingerprint).toMatch(/^[A-Za-z0-9_-]{4}( [A-Za-z0-9_-]{4}){3}$/);
    expect(formatIdentityFingerprint(publicKey)).toBe(fingerprint);
    expect(formatIdentityFingerprint('')).toBe('');
    expect(fingerprint.replace(/ /g, '')).not.toBe(publicKey.slice(0, 16));
  });
});
