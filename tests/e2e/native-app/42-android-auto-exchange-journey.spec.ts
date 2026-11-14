/**
 * Automatic Talk exchange on two real phones (OPEN-112): the same journey body the browser spec
 * staged/stage2-two-user/98-auto-exchange runs (tests/e2e/journeys/auto-exchange-journey.ts).
 * Phone A switches a private Talk to Broadcast On — no Broadcast step — and phone B receives it
 * and answers with Auto; a second public Talk with the same question is then answered by B's
 * chatbot with nobody tapping. Clears both phones' app data.
 *
 *   E2E_REAL_ANDROID_JOURNEYS=1 NATIVE_APP_ANDROID_SERIALS=<a>,<b> \
 *     npx playwright test --config tests/e2e/native-app/playwright.config.ts tests/e2e/native-app/42-android-auto-exchange-journey.spec.ts
 */
import { test } from '@playwright/test';
import * as os from 'os';
import { bootstrapNativeWindow } from './helpers/native-app';
import { closeAndroidUser, isAndroidDeviceReady, launchAndroidUserViaAdb, resetAndroidAppData, type AndroidUser } from './helpers/native-app-android';
import { autoExchangeJourney } from '../journeys/auto-exchange-journey';

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

test.describe('Two real phones: automatic Talk exchange, chatbot answers', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_JOURNEYS=1 to run the physical-device journeys.');
  test.skip(SERIALS.length < 2, 'NATIVE_APP_ANDROID_SERIALS needs two phones.');

  const users: AndroidUser[] = [];
  test.afterAll(async () => {
    for (const user of users) await closeAndroidUser(user);
  });

  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument
  test('publish → received with no tap → Auto answer → chatbot answers the next one', async ({}, testInfo) => {
    test.setTimeout(900_000);
    const [serialA, serialB] = SERIALS;
    for (const serial of [serialA!, serialB!]) test.skip(!(await isAndroidDeviceReady(serial)), `${serial} unavailable`);
    await Promise.all([resetAndroidAppData(serialA!), resetAndroidAppData(serialB!)]);
    const actors = [];
    for (const [name, serial] of [['Alice', serialA!], ['Bob', serialB!]] as const) {
      const user = await launchAndroidUserViaAdb({ hubGunUrl: `http://${lanIp()}:${HUB_GUN_PORT}/gun`, deviceSerial: serial });
      users.push(user);
      await bootstrapNativeWindow(user.window, `auto-${name.toLowerCase()}`, { waitForSupportGreeting: false, readinessTimeoutMs: 150_000 });
      actors.push({ id: `${name} (${serial})`, runtime: 'android-webview' as const, page: user.window });
    }
    const { timings } = await autoExchangeJourney(actors[0]!, actors[1]!);
    console.log(`[auto-exchange] ${JSON.stringify(timings)}`);
    await testInfo.attach('auto-exchange-timings.json', { body: Buffer.from(JSON.stringify(timings, null, 2)), contentType: 'application/json' });
  });
});
