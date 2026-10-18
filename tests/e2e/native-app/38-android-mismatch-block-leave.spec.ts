/**
 * Mismatch, block and leave on two real phones: the same journey bodies phone-path/04 runs with
 * host phone nodes (tests/e2e/journeys/mismatch-block-leave-journey.ts). Each test starts from
 * cleared app data on both phones.
 *
 *   E2E_REAL_ANDROID_JOURNEYS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/38-android-mismatch-block-leave.spec.ts
 */
import { test } from '@playwright/test';
import type { ChildProcess } from 'child_process';
import * as os from 'os';
import { closeAndroidUser, isAndroidDeviceReady, launchAndroidUserViaAdb, resetAndroidAppData, type AndroidUser } from './helpers/native-app-android';
import { preparePlacePhone, startReleaseCapacityHub } from './helpers/release-hub';
import { blockJourney, leaveJourney, mismatchJourney } from '../journeys/mismatch-block-leave-journey';
import type { TestActor } from '../helpers/test-actor';

const RUN = process.env.E2E_REAL_ANDROID_JOURNEYS === '1';
const SERIALS = String(process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((serial) => serial.trim()).filter(Boolean);
// J-ROOM-03 creates a Place, which needs a hub with the release capacity (helpers/release-hub.ts).
// Not 9178: native-app/33 starts its own release hub there and may run at the same time.
const HUB_PORT = Number(process.env.E2E_JOURNEY_HUB_PORT || '9278');

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

test.describe('Two real phones: mismatch, block and leave', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_JOURNEYS=1 to run the physical-device journeys.');
  test.skip(SERIALS.length < 2, 'NATIVE_APP_ANDROID_SERIALS needs two phones.');

  let hub: ChildProcess | undefined;
  let users: Array<AndroidUser | undefined> = [];
  // A fresh hub for each test, as phone-path/04 resets its own: the identities an earlier test
  // left in the room would otherwise expire during J-ROOM-03 and skew its headcount.
  test.beforeEach(async () => {
    hub = await startReleaseCapacityHub(HUB_PORT);
  });
  test.afterEach(async () => {
    for (const user of users) await closeAndroidUser(user);
    users = [];
    hub?.kill('SIGTERM');
    await new Promise((resolve) => hub?.once('exit', resolve) ?? resolve(undefined));
    hub = undefined;
  });

  async function twoPhones(): Promise<[TestActor, TestActor]> {
    const [serialA, serialB] = SERIALS;
    for (const serial of [serialA!, serialB!]) test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
    await Promise.all([resetAndroidAppData(serialA!), resetAndroidAppData(serialB!)]);
    const actors: TestActor[] = [];
    for (const [name, serial] of [['Alice', serialA!], ['Bob', serialB!]] as const) {
      const user = await launchAndroidUserViaAdb({ hubGunUrl: `http://${lanIp()}:${HUB_PORT}/gun`, deviceSerial: serial, disableLanDiscovery: true });
      users.push(user);
      await preparePlacePhone(user, `journey-${name.toLowerCase()}`);
      actors.push({ id: `${name} (${serial})`, runtime: 'android-webview', page: user.window });
    }
    return [actors[0]!, actors[1]!];
  }

  test('J-TALK-04: a non-matching answer gives neither person a conversation', async () => {
    test.setTimeout(600_000);
    const [alice, bob] = await twoPhones();
    await mismatchJourney(alice, bob);
  });

  test('J-TALK-05: after Bob blocks Alice, her Talks stop arriving on his phone', async () => {
    test.setTimeout(600_000);
    const [alice, bob] = await twoPhones();
    await blockJourney(alice, bob);
  });

  test('J-ROOM-03: when Alice leaves, Bob\'s member list and headcount drop her', async () => {
    test.setTimeout(900_000);
    const [alice, bob] = await twoPhones();
    const { goneAfterMs } = await leaveJourney(alice, bob, {
      hubUrl: `http://127.0.0.1:${HUB_PORT}`,
      // A phone app being killed: force-stop, no leave request.
      closeAlice: async () => { await closeAndroidUser(users[0]); users[0] = undefined; },
    });
    test.info().annotations.push({ type: 'timing', description: `app closed → gone for Bob: ${goneAfterMs} ms` });
  });
});
