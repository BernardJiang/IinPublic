/**
 * Focused physical-device regression for the Talk Editor's authoritative commit boundary.
 *
 * A local `myTalks` projection used to appear before the Gun repository write completed. If
 * that write failed, users saw "Failed to create talk" while E2E still found the ghost OUT row
 * and passed. This opt-in test requires the Talk in the device graph (OPEN-106) as well as the
 * UI row.
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
import { configuredAndroidDevices } from './helpers/android-device-config';

const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim() || configuredAndroidDevices()[0]?.serial || '';
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

    // The graph's error count persists with the app's data: only errors from this Talk count.
    const errorsBefore = await user.window.evaluate(async () => Number((await (window as any).__iinpublic_device_graph_status?.())?.errors ?? 0));
    const title = `android-authoritative-${ANDROID_SERIAL}-${Date.now()}`;
    const created = await createTagTalkViaEditor(user.window, { title, timeoutMs: 90_000 });
    // OPEN-106: my Talks are committed to the device graph (the old private `talks/<id>` record is
    // gone). The core reads it back from the graph under the id the OUT row carries.
    const record = await user.window.evaluate(async (talkId) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const body = await app?.coreRequest?.({ name: 'graph.talkBody', talkId });
      const status = await (window as any).__iinpublic_device_graph_status?.();
      return { id: body?.id, title: body?.title, hasQuestions: Array.isArray(body?.questions) && body.questions.length > 0, graphErrors: status?.errors ?? null };
    }, created.talkId);
    record.graphErrors = record.graphErrors === null ? null : record.graphErrors - errorsBefore;

    expect(record).toEqual({ id: created.talkId, title, hasQuestions: true, graphErrors: 0 });
  });
});
