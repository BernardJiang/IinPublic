/**
 * Focused physical-device regression for the Talk Editor's authoritative commit boundary.
 *
 * A local `myTalks` projection used to appear before the Gun repository write completed. If
 * that write failed, users saw "Failed to create talk" while E2E still found the ghost OUT row
 * and passed. This opt-in test requires the real repository record as well as the UI row.
 */
import { expect, test } from '@playwright/test';
import * as os from 'os';
import { createTagTalkViaEditor } from '../helpers/talk-demo-ui';
import { bootstrapNativeWindow, forceJoinGlobal } from './helpers/native-app';
import {
  clearAndroidE2ETestProjections,
  closeAndroidUser,
  launchAndroidUserViaAdb,
  type AndroidUser,
} from './helpers/native-app-android';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || '';
const RUN = process.env.E2E_REAL_ANDROID_TALK_COMMIT === '1';

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

test.describe('Native app: Android authoritative Talk commit', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_TALK_COMMIT=1 to run the physical-device commit test.');
  test.skip(!ANDROID_SERIAL, 'Set NATIVE_APP_ANDROID_SERIAL to the target adb serial.');

  let user: AndroidUser | undefined;

  test.afterEach(async () => {
    if (user) await clearAndroidE2ETestProjections(user);
    await closeAndroidUser(user);
    user = undefined;
  });

  test('creates an OUT row only after its Gun repository record is readable', async () => {
    test.setTimeout(240_000);
    user = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL,
      hubGunUrl: `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`,
    });

    user.window.on('console', (message) => {
      if (/failed to create talk/i.test(message.text())) {
        console.log(`[android-talk-commit] console ${message.type()}: ${message.text()}`);
      }
    });
    user.window.on('response', (response) => {
      if (response.status() < 400) return;
      void response.text().catch(() => '').then((body) => {
        console.log(`[android-talk-commit] HTTP ${response.status()} ${response.url()}: ${body.slice(0, 500)}`);
      });
    });

    await bootstrapNativeWindow(user.window, 'Android Talk Commit', {
      waitForSupportGreeting: false,
      readinessTimeoutMs: 110_000,
      pinStableLocation: false,
      updateStageName: false,
    });
    await forceJoinGlobal(user.window);

    const title = `android-authoritative-${ANDROID_SERIAL}-${Date.now()}`;
    const created = await createTagTalkViaEditor(user.window, { title, timeoutMs: 90_000 });
    const record = await user.window.evaluate(async (talkId) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const ownerSeaPub = String(app?.gunService?.getStoredPair?.()?.pub || '');
      if (!ownerSeaPub) throw new Error('No SEA public key for repository verification');
      const soul = `users/${encodeURIComponent(ownerSeaPub)}/talks/${encodeURIComponent(talkId)}`;
      const raw = await app.gunService.get(soul);
      return {
        version: raw?.version,
        talkId: raw?.talkId,
        parsedTalkId: raw?.talkJson ? JSON.parse(raw.talkJson)?.id : '',
      };
    }, created.talkId);

    expect(record).toEqual({ version: 1, talkId: created.talkId, parsedTalkId: created.talkId });
  });
});
