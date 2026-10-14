/**
 * Release smoke: Places on two real Android phones (docs/testing/journey-coverage.md, J-PLACE-*).
 *
 * Phone 1 creates a Place through the New Room dialog; phone 2 finds it in its room list and
 * enters it; each sees the other in the member list; both go home and phone 2 still sees the
 * empty Place under "Places near you" and can enter it again.
 *
 * The phones talk to a hub this spec starts on the Mac's LAN address with the release capacity
 * (498) — never www.iinpublic.com, so no public, undeletable Place is created. The native-app
 * config's own hub uses capacity 50, which the release web bundle on the phone does not accept for
 * Place admission.
 *
 * Opt-in and destructive: clears IinPublic app data on both phones.
 *   E2E_REAL_ANDROID_PLACE_SMOKE=1 NATIVE_APP_ANDROID_SERIALS=<serial1>,<serial2> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/33-android-place-smoke.spec.ts
 * or as part of `npm run test:android:release-smoke`.
 */
import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { bootstrapNativeWindow } from './helpers/native-app';
import {
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { resolveAndroidMatrixDevices } from './helpers/android-device-config';
import { waitForAppReady } from '../helpers/timing';
import {
  createPlace,
  currentRoomId,
  enterRoomFromList,
  memberItem,
  returnHome,
  userId,
  waitForRoomRow,
} from '../phone-path/phone-path-helpers';

const RUN = process.env.E2E_REAL_ANDROID_PLACE_SMOKE === '1';
const HUB_PORT = Number(process.env.E2E_PLACE_SMOKE_HUB_PORT || '9178');
const DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');
const LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10 };
const repoRoot = path.resolve(__dirname, '..', '..', '..');

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function waitForHub(): Promise<void> {
  await expect.poll(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${HUB_PORT}/health`)).ok;
    } catch {
      return false;
    }
  }, { timeout: 60_000, message: 'release-capacity hub did not start' }).toBe(true);
}

/** Confirm the phone's location the way a GPS fix does, then let the WebView reload with the
 *  contact minimum lifted (a fresh install has no contacts; the gate has its own spec). */
async function prepare(user: AndroidUser, label: string): Promise<void> {
  await bootstrapNativeWindow(user.window, label, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000, pinStableLocation: false });
  // Wait for the reload itself before probing the page: a probe during the navigation throws
  // "Execution context was destroyed", which ends the poll instead of retrying it.
  await Promise.all([
    user.window.waitForURL(/e2e_place_min_contacts=0/, { timeout: 60_000 }),
    user.window.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('e2e_place_min_contacts', '0');
      window.location.replace(url.toString());
    }).catch(() => undefined),
  ]);
  await user.window.waitForLoadState('domcontentloaded');
  await waitForAppReady(user.window, 150_000);
  await user.window.evaluate(async (location) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    await app.updateLocationAndMaybeSwitch({ ...location, timestamp: new Date() });
  }, LOCATION);
  await expect.poll(() => currentRoomId(user.window), { timeout: 60_000 }).toMatch(/^nearby_/);
}

test.describe('Android release smoke: Places on two phones', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_PLACE_SMOKE=1 (clears app data on two phones).');

  let hub: ChildProcess | undefined;
  const users: AndroidUser[] = [];

  test.beforeAll(async () => {
    const env = { ...process.env, E2E_GUN_MEMORY_ONLY: '1', PORT: String(HUB_PORT) };
    delete env.CHATROOM_MAX_CAPACITY;
    delete env.CHATROOM_ENABLE_FIFO;
    hub = spawn(process.execPath, [path.join(repoRoot, 'dist', 'server', 'server', 'index.js')], { cwd: repoRoot, env, stdio: 'ignore' });
    await waitForHub();
  });

  test.afterAll(async () => {
    for (const user of users) await closeAndroidUser(user).catch(() => {});
    hub?.kill('SIGTERM');
  });

  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const user of users) {
      const diagnostics = await collectAndroidDiagnostics(user.deviceSerial);
      await testInfo.attach(`${user.deviceSerial}-logcat.txt`, { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
      await testInfo.attach(`${user.deviceSerial}-node-stdio.txt`, { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
    }
  });

  test('phone 1 creates a Place; phone 2 finds, enters, leaves and re-enters it', async () => {
    test.setTimeout(900_000);
    const ready = [];
    for (const device of DEVICES) if (await isAndroidDeviceReady(device.serial)) ready.push(device);
    test.skip(ready.length < 2, `Needs two connected phones; found ${ready.length}.`);
    const [first, second] = ready;
    const hubGunUrl = `http://${lanIp()}:${HUB_PORT}/gun`;

    for (const device of [first, second]) {
      await resetAndroidAppData(device.serial);
      users.push(await launchAndroidUserViaAdb({ hubGunUrl, deviceSerial: device.serial, disableLanDiscovery: true }));
    }
    const [one, two] = users;
    await prepare(one, 'Place Smoke 1');
    await prepare(two, 'Place Smoke 2');
    const [oneId, twoId] = [await userId(one.window), await userId(two.window)];

    const name = `Smoke Place ${Date.now()}`;
    const placeId = await createPlace(one.window, name);
    await enterRoomFromList(two.window, placeId);
    await expect(memberItem(one.window, twoId)).toBeAttached({ timeout: 60_000 });
    await expect(memberItem(two.window, oneId)).toBeAttached({ timeout: 60_000 });

    await returnHome(two.window);
    await returnHome(one.window);
    await waitForRoomRow(two.window, placeId, 60_000);
    await enterRoomFromList(two.window, placeId);
  });
});
