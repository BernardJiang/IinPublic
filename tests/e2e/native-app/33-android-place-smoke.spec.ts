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
import type { ChildProcess } from 'child_process';
import * as os from 'os';
import {
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { resolveAndroidMatrixDevices } from './helpers/android-device-config';
import { preparePlacePhone, startReleaseCapacityHub } from './helpers/release-hub';
import {
  createPlace,
  enterRoomFromList,
  memberItem,
  returnHome,
  userId,
  waitForRoomRow,
} from '../phone-path/phone-path-helpers';

const RUN = process.env.E2E_REAL_ANDROID_PLACE_SMOKE === '1';
const HUB_PORT = Number(process.env.E2E_PLACE_SMOKE_HUB_PORT || '9178');
const DEVICES = resolveAndroidMatrixDevices(process.env.NATIVE_APP_ANDROID_SERIALS || '');

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

test.describe('Android release smoke: Places on two phones', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_PLACE_SMOKE=1 (clears app data on two phones).');

  let hub: ChildProcess | undefined;
  const users: AndroidUser[] = [];

  test.beforeAll(async () => {
    hub = await startReleaseCapacityHub(HUB_PORT);
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
    await preparePlacePhone(one, 'Place Smoke 1');
    await preparePlacePhone(two, 'Place Smoke 2');
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
