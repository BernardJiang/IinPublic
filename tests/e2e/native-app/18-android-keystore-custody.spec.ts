/**
 * OPEN-06 (Android): identity custody lives in an Android Keystore AES-256-GCM key on real
 * hardware. Per configured phone: fresh app data -> the SEA pair is readable through the native
 * bridge, no plaintext/IndexedDB copy exists in the WebView, the app-private prefs hold only
 * ciphertext, and the same public identity survives a force-stop relaunch.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import {
  ANDROID_PACKAGE,
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';

const execFileAsync = promisify(execFile);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const SERIALS = process.env.NATIVE_APP_ANDROID_SERIAL?.trim()
  ? [process.env.NATIVE_APP_ANDROID_SERIAL.trim()]
  : configuredAndroidDevices().map((d) => d.serial);

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

async function readBridge(user: AndroidUser) {
  return user.window.evaluate(() => {
    const bridge = (window as any).IinPublicCustody;
    return bridge
      ? { describe: JSON.parse(bridge.describe()), read: JSON.parse(bridge.read()) }
      : null;
  });
}

for (const serial of SERIALS) {
  test.describe(`Android Keystore custody on ${serial}`, () => {
    let user: AndroidUser | undefined;
    test.afterEach(async () => { await closeAndroidUser(user); user = undefined; });

    test('stores the SEA pair in Keystore custody and survives restart', async ({}, testInfo) => {
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial, resetAppData: true });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });

      await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 45_000 }).not.toBeNull();
      const first = (await readBridge(user!))!;
      expect(first.describe.provider).toBe('android-keystore');
      expect(first.describe.available).toBe(true);
      await testInfo.attach('describe.json', { body: JSON.stringify(first.describe), contentType: 'application/json' });
      const pub: string = first.read.pair.pub;
      const priv: string = first.read.pair.priv;

      const webviewCopy = await user.window.evaluate(() => ({
        plaintext: localStorage.getItem('iinpublic_keypair'),
        v1Record: localStorage.getItem('iinpublic_key_custody_v1'),
      }));
      expect(webviewCopy.plaintext).toBeNull();
      expect(JSON.stringify(webviewCopy)).not.toContain(priv);

      const { stdout } = await execFileAsync('adb', ['-s', serial, 'shell', 'run-as', ANDROID_PACKAGE, 'cat',
        'shared_prefs/iinpublic_identity_custody_v3.xml']);
      expect(stdout).toContain(pub);
      expect(stdout).not.toContain(priv);
      expect(stdout).toContain('name="ct"');

      await closeAndroidUser(user);
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 45_000 }).toBe(pub);
    });
  });
}
