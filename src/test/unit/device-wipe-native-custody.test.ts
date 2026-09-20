/** @jest-environment jsdom */

import { eraseDeviceStorage } from '../../web/services/device-wipe';

const pair = { pub: 'public', epub: 'epublic', priv: 'private', epriv: 'eprivate' };

function installAndroidBridge(options: { removeFails?: boolean; retainAfterRemove?: boolean } = {}): void {
  let stored: typeof pair | null = { ...pair };
  Object.defineProperty(globalThis, 'IinPublicCustody', {
    configurable: true,
    value: {
      describe: () => '{"version":1,"provider":"android-keystore","available":true,"hardwareBacked":true}',
      read: () => JSON.stringify({ pair: stored }),
      write: () => '{"ok":true}',
      remove: () => {
        if (options.removeFails) return '{"ok":false,"reason":"commit-failed"}';
        if (!options.retainAfterRemove) stored = null;
        return '{"ok":true}';
      },
    },
  });
}

afterEach(() => {
  delete (globalThis as any).IinPublicCustody;
  localStorage.clear();
});

describe('native custody device wipe', () => {
  it('removes and verifies OS-keystore custody before clearing browser storage', async () => {
    installAndroidBridge();
    localStorage.setItem('identity-owned-data', 'present');
    await eraseDeviceStorage();
    expect(localStorage.length).toBe(0);
    expect(JSON.parse((globalThis as any).IinPublicCustody.read()).pair).toBeNull();
  });

  it('fails closed when the native bridge refuses removal', async () => {
    installAndroidBridge({ removeFails: true });
    localStorage.setItem('identity-owned-data', 'present');
    await expect(eraseDeviceStorage()).rejects.toThrow('Native custody operation failed');
    expect(localStorage.getItem('identity-owned-data')).toBe('present');
  });

  it('fails closed when native custody remains after a claimed successful removal', async () => {
    installAndroidBridge({ retainAfterRemove: true });
    localStorage.setItem('identity-owned-data', 'present');
    await expect(eraseDeviceStorage()).rejects.toThrow('remained after erase');
    expect(localStorage.getItem('identity-owned-data')).toBe('present');
  });
});
