/**
 * OPEN-06 (macOS Electron): identity custody uses Electron safeStorage (macOS login Keychain).
 * The app boots, its SEA pair is readable through the native bridge, the WebView holds no
 * plaintext copy, the on-disk record is ciphertext, and the same public identity survives a full
 * app close/relaunch on the same profile.
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bootstrapNativeWindow, launchNativeUser, type NativeUser } from './helpers/native-app';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const APP_PORT = 19170;

test.describe('macOS Electron safeStorage custody', () => {
  test.skip(process.platform !== 'darwin', 'macOS only');
  let user: NativeUser | undefined;
  let userDataDir = '';
  test.afterAll(async () => {
    await user?.app.close().catch(() => {});
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  const readBridge = (u: NativeUser) => u.window.evaluate(async () => {
    const custody = (window as any).iinpublicNative?.custody;
    return custody ? { describe: await custody.describe(), read: await custody.read() } : null;
  });

  test('stores the SEA pair via safeStorage and survives relaunch', async () => {
    test.setTimeout(5 * 60_000);
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-macos-custody-e2e-'));
    const hubGunUrl = `http://127.0.0.1:${HUB_GUN_PORT}/gun`;
    user = await launchNativeUser({ localPort: APP_PORT, hubGunUrl, userDataDir });
    await bootstrapNativeWindow(user.window, 'Custody Mac', { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false });

    await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 30_000 }).not.toBeNull();
    const first = (await readBridge(user!))!;
    expect(first.describe).toMatchObject({ provider: 'electron-safe-storage', available: true });
    const { pub, priv } = first.read.pair;

    const webview = await user.window.evaluate(() => ({
      plaintext: localStorage.getItem('iinpublic_keypair'),
      v1: localStorage.getItem('iinpublic_key_custody_v1'),
    }));
    expect(webview.plaintext).toBeNull();
    expect(JSON.stringify(webview)).not.toContain(priv);

    const record = fs.readFileSync(path.join(userDataDir, 'identity-custody-v3.bin'));
    expect(record.includes(Buffer.from(priv))).toBe(false);

    await user.app.close();
    user = await launchNativeUser({ localPort: APP_PORT, hubGunUrl, userDataDir });
    await bootstrapNativeWindow(user.window, 'Custody Mac', { waitForSupportGreeting: false, readinessTimeoutMs: 110_000, pinStableLocation: false, updateStageName: false });
    await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 30_000 }).toBe(pub);
  });
});
