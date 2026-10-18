/**
 * The two-person core loop on two real phones: the same journey body phone-path/02 runs with host
 * phone nodes (tests/e2e/journeys/talk-match-chat-journey.ts). Phone A broadcasts a talk in the
 * shared Nearby room, phone B answers with the match, both get the conversation, the direct P2P
 * channel connects, and a message from A shows on B's screen. Clears both phones' app data.
 *
 *   E2E_REAL_ANDROID_JOURNEYS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/37-android-talk-match-chat-journey.spec.ts
 */
import { test } from '@playwright/test';
import * as os from 'os';
import { bootstrapNativeWindow } from './helpers/native-app';
import { closeAndroidUser, isAndroidDeviceReady, launchAndroidUserViaAdb, resetAndroidAppData, type AndroidUser } from './helpers/native-app-android';
import { talkMatchChatJourney } from '../journeys/talk-match-chat-journey';

const RUN = process.env.E2E_REAL_ANDROID_JOURNEYS === '1';
const SERIALS = String(process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((serial) => serial.trim()).filter(Boolean);
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');

function lanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  throw new Error('Set NATIVE_APP_ANDROID_HOST');
}

test.describe('Two real phones: talk → answer → match → P2P chat', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_JOURNEYS=1 to run the physical-device journeys.');
  test.skip(SERIALS.length < 2, 'NATIVE_APP_ANDROID_SERIALS needs two phones.');

  const users: AndroidUser[] = [];
  test.afterAll(async () => {
    for (const user of users) await closeAndroidUser(user);
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  test('broadcast → received → answered → match → P2P chat', async ({}, testInfo) => {
    test.setTimeout(600_000);
    const [serialA, serialB] = SERIALS;
    for (const serial of [serialA!, serialB!]) test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
    await Promise.all([resetAndroidAppData(serialA!), resetAndroidAppData(serialB!)]);
    const actors = [];
    for (const [name, serial] of [['Alice', serialA!], ['Bob', serialB!]] as const) {
      const user = await launchAndroidUserViaAdb({ hubGunUrl: `http://${lanIp()}:${HUB_GUN_PORT}/gun`, deviceSerial: serial });
      users.push(user);
      await bootstrapNativeWindow(user.window, `journey-${name.toLowerCase()}`, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000 });
      actors.push({ id: `${name} (${serial})`, runtime: 'android-webview' as const, page: user.window });
    }
    const { timings } = await talkMatchChatJourney(actors[0]!, actors[1]!);
    console.log(`[journey] ${JSON.stringify(timings)}`);
    await testInfo.attach('journey-timings.json', { body: Buffer.from(JSON.stringify(timings, null, 2)), contentType: 'application/json' });
  });
});
