/**
 * OPEN-29 (Android): an installed app holding a STALE recovery-anchor cache catches up to the
 * hub's newer record, and an app already holding a NEWER record never rolls back.
 *
 * On a phone the record can arrive two ways: the embedded node's `GET /api/support/recovery`,
 * which relays to the hub (`embedded-hub-relay-client.ts`) and which `app.ts` polls every 5 s, or
 * Gun sync with the hub. This spec checks the installed app's end state whichever path lands
 * first; spec 91 (stage1) covers the browser.
 *
 * Records are signed in this Node process with the real recovery key from `.env.local`
 * (`TECHSUPPORT_RECOVERY_SEA_PAIR_JSON`); the spec skips without it. Only "now" records are posted
 * and none revoke a key. App data is NOT reset — the spec only seeds and finally removes the
 * recovery cache key, so the phone keeps its identity.
 */
import { test, expect } from '@playwright/test';
import * as os from 'os';
import {
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';
import { configuredAndroidDevices } from './helpers/android-device-config';
import { loadRealTechSupportRecoveryPair } from '../../../src/test/support/techsupport-real-pair';
import { signRecoveryAnchor, type RecoveryAnchorRecord } from '../../../src/shared/techsupport-recovery';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const SERIALS = process.env.NATIVE_APP_ANDROID_SERIAL?.trim()
  ? [process.env.NATIVE_APP_ANDROID_SERIAL.trim()]
  : configuredAndroidDevices().map((d) => d.serial);
const RECOVERY_PAIR = loadRealTechSupportRecoveryPair();
const CACHE_KEY = 'iinpublic_techsupport_recovery_anchor_v1';
const HOUR_MS = 60 * 60 * 1000;

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

async function postToHub(record: RecoveryAnchorRecord): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${HUB_GUN_PORT}/api/support/recovery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function cachedIssuedAt(user: AndroidUser): Promise<string | null> {
  return user.window.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw).issuedAt as string) : null;
  }, CACHE_KEY);
}

async function seedCache(user: AndroidUser, record: RecoveryAnchorRecord): Promise<void> {
  await user.window.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: CACHE_KEY,
    value: JSON.stringify(record),
  });
}

for (const serial of SERIALS) {
  test.describe(`Android recovery-anchor catch-up on ${serial}`, () => {
    test.skip(!RECOVERY_PAIR, 'Set TECHSUPPORT_RECOVERY_SEA_PAIR_JSON in .env.local to run this recovery-anchor spec.');
    let user: AndroidUser | undefined;

    test.afterEach(async () => {
      await user?.window.evaluate((key) => localStorage.removeItem(key), CACHE_KEY).catch(() => {});
      await closeAndroidUser(user);
      user = undefined;
    });

    test('stale cache catches up to the hub record; newer cache never rolls back', async () => {
      test.setTimeout(240_000);
      test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
      const pair = RECOVERY_PAIR!;
      const hubGunUrl = `http://${lanIp()}:${HUB_GUN_PORT}/gun`;
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 60_000 });

      const now = Date.now();
      const stale = await signRecoveryAnchor(
        { reason: 'e2e OPEN-29 android: stale cached record', issuedAt: new Date(now - HOUR_MS).toISOString() },
        pair,
      );
      const future = await signRecoveryAnchor(
        { reason: 'e2e OPEN-29 android: newer cached record', issuedAt: new Date(now + HOUR_MS).toISOString() },
        pair,
      );

      // The installed app missed the incident: its cache holds an older record. Publish the
      // newer one to the hub only now, so the phone must learn it while running.
      await seedCache(user, stale);
      expect(await cachedIssuedAt(user)).toBe(stale.issuedAt);
      const published = await signRecoveryAnchor(
        { reason: 'e2e OPEN-29 android: hub record', issuedAt: new Date(Date.now()).toISOString() },
        pair,
      );
      const posted = await postToHub(published);
      expect(posted.status, JSON.stringify(posted.body)).toBe(200);
      await expect.poll(() => cachedIssuedAt(user!), { timeout: 60_000, intervals: [1_000] }).toBe(published.issuedAt);

      // A newer local record survives several relay-poll ticks and a full force-stop relaunch.
      await seedCache(user, future);
      await user.window.waitForTimeout(15_000);
      expect(await cachedIssuedAt(user)).toBe(future.issuedAt);
      await closeAndroidUser(user);
      user = await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: serial });
      await expect(user.window.locator('#app')).toBeVisible({ timeout: 60_000 });
      await user.window.waitForTimeout(15_000);
      expect(await cachedIssuedAt(user)).toBe(future.issuedAt);
    });
  });
}
