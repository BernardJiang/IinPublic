/**
 * OPEN-06 (Android): identity custody lives in an Android Keystore AES-256-GCM key on real
 * hardware. Per configured phone: fresh app data -> the SEA pair is readable through the native
 * bridge, no plaintext/IndexedDB copy exists in the WebView, the app-private prefs hold only
 * ciphertext, the same public identity survives a force-stop relaunch and verified v1 migration,
 * conflicts fail closed, and erase/reinstall each create an unrelated identity.
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
import { afterNav } from '../helpers/timing';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

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
  try {
    return await user.window.evaluate(() => {
      const bridge = (window as any).IinPublicCustody;
      return bridge
        ? { describe: JSON.parse(bridge.describe()), read: JSON.parse(bridge.read()) }
        : null;
    });
  } catch (error) {
    // Erase intentionally reloads the WebView. A poll can land between the old execution
    // context being destroyed and the new one becoming ready; represent that as not-ready.
    if (String(error).includes('Execution context was destroyed')) return null;
    throw error;
  }
}

async function stageInstalledApkForReinstall(serial: string): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, 'shell', 'pm', 'path', ANDROID_PACKAGE], { timeout: 5_000 });
  const installedPath = String(result.stdout).trim().replace(/^package:/, '');
  if (!installedPath.startsWith('/data/app/')) throw new Error(`Unexpected installed APK path: ${installedPath}`);
  const stagedPath = `/data/local/tmp/iinpublic-custody-reinstall-${process.pid}.apk`;
  await execFileAsync('adb', ['-s', serial, 'shell', 'cp', installedPath, stagedPath], { timeout: 30_000 });
  return stagedPath;
}

async function openEraseDevice(page: AndroidUser['window']): Promise<void> {
  if (await page.locator('[data-testid="walkthrough-modal"]').isVisible().catch(() => false)) {
    await page.locator('[data-testid="walkthrough-skip-btn"]').click();
    await expect(page.locator('[data-testid="walkthrough-modal"]')).toHaveCount(0);
  }
  await page.locator('.nav-btn[data-view="settings"]').click();
  await afterNav();
  await openSettingsSection(page, SETTINGS_SECTION.eraseDevice);
  await page.locator('[data-testid="settings-erase-device-btn"]').click();
  await expect(page.locator('[data-testid="erase-device-modal"]')).toBeVisible({ timeout: 20_000 });
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

    test('migrates atomically, refuses identity conflict, erases custody, and resets on reinstall', async () => {
      test.setTimeout(600_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      let stagedApk = '';

      try {
        user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial, resetAppData: true });
        await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
        await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 45_000 }).not.toBeNull();
        const originalPair = (await readBridge(user))!.read.pair;
        // This test targets custody, not onboarding. Mark the walkthrough complete before the
        // migration reload so its delayed auto-open cannot cover the erase confirmation later.
        await user.window.evaluate(() => localStorage.setItem('iinpublic_walkthrough_seen', 'true'));

        // Recreate the legacy v1 source with the exact active pair, remove native custody, and
        // restart. Production startup must copy -> verify native -> delete v1 without changing
        // any SEA field.
        const prepared = await user.window.evaluate(async (pair) => {
          const app = (window as any).__iinpublic_app.getApp();
          await app.gunService.persistCustodyRecord(pair);
          const removed = JSON.parse((window as any).IinPublicCustody.remove(pair.pub, pair.epub));
          return {
            removed,
            nativeAfter: JSON.parse((window as any).IinPublicCustody.read()),
            hasV1: !!localStorage.getItem('iinpublic_key_custody_v1'),
          };
        }, originalPair);
        expect(prepared.removed.ok).toBe(true);
        expect(prepared.nativeAfter.pair).toBeNull();
        expect(prepared.hasV1).toBe(true);

        // Reload is the actual v1 -> v3 startup migration boundary. Do not force-kill the
        // WebView immediately after synthesizing the v1 row: old Android WebViews can defer
        // flushing a brand-new localStorage write to disk until after this task, which would
        // turn the fixture into a no-source fresh boot rather than a migration test.
        await user.window.reload();
        await expect(user.window.locator('#app')).toBeVisible({ timeout: 45_000 });
        await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 45_000 }).toBe(originalPair.pub);
        const migrated = await readBridge(user);
        expect(migrated!.read.pair).toEqual(originalPair);
        expect(await user.window.evaluate(() => localStorage.getItem('iinpublic_key_custody_v1'))).toBeNull();

        // Exercise the real native manager/bridge against a conflicting source. It must reject
        // before write and leave the current Keystore identity byte-for-byte intact.
        const conflict = await user.window.evaluate(async () => {
          const manager = (window as any).__iinpublic_app.getApp().gunService.getBrowserPasswordFreeCustodyManager();
          try {
            await manager.migrateFrom({
              readPair: async () => ({ pub: 'conflict-pub', epub: 'conflict-epub', priv: 'conflict-priv', epriv: 'conflict-epriv' }),
              removeIfMatches: async () => { throw new Error('must not remove conflict source'); },
            });
            return '';
          } catch (error) {
            return error instanceof Error ? error.message : String(error);
          }
        });
        expect(conflict).toContain('conflict');
        expect((await readBridge(user))!.read.pair).toEqual(originalPair);

        // The user-visible erase flow must clear the OS bridge before reloading. The new boot
        // creates an unrelated SEA identity in native custody, never a lingering v1 WebView copy.
        await openEraseDevice(user.window);
        await user.window.locator('[data-testid="erase-confirm-input"]').fill('ERASE');
        await user.window.locator('[data-testid="erase-device-btn"]').click();
        await user.window.waitForLoadState('load').catch(() => {});
        await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 60_000 }).not.toBeNull();
        const afterErasePair = (await readBridge(user))!.read.pair;
        expect(afterErasePair.pub).not.toBe(originalPair.pub);
        expect(await user.window.evaluate(() => localStorage.getItem('iinpublic_key_custody_v1'))).toBeNull();

        // Preserve the exact installed APK in shell-owned temp storage so uninstall/reinstall
        // tests package semantics without another multi-minute USB transfer.
        stagedApk = await stageInstalledApkForReinstall(serial);
        await closeAndroidUser(user);
        user = undefined;
        await execFileAsync('adb', ['-s', serial, 'uninstall', ANDROID_PACKAGE], { timeout: 30_000 });
        await execFileAsync('adb', ['-s', serial, 'shell', 'pm', 'install', '-r', stagedApk], { timeout: 120_000 });
        user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
        await expect.poll(async () => (await readBridge(user!))?.read?.pair?.pub ?? null, { timeout: 60_000 }).not.toBeNull();
        const afterReinstall = (await readBridge(user))!;
        expect(afterReinstall.describe.provider).toBe('android-keystore');
        expect(afterReinstall.read.pair.pub).not.toBe(afterErasePair.pub);
        expect(await user.window.evaluate(() => ({
          plaintext: localStorage.getItem('iinpublic_keypair'),
          v1: localStorage.getItem('iinpublic_key_custody_v1'),
        }))).toEqual({ plaintext: null, v1: null });
      } finally {
        if (stagedApk) {
          await execFileAsync('adb', ['-s', serial, 'shell', 'rm', '-f', stagedApk], { timeout: 5_000 }).catch(() => undefined);
        }
      }
    });
  });
}
