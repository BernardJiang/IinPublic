import { expect, test } from '@playwright/test';
import path from 'node:path';
import {
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  readAndroidDeviceMetadata,
  type AndroidUser,
} from './helpers/native-app-android';
import { runPortableCoreOnActor } from '../helpers/portable-core-actor';

const ENABLED = process.env.E2E_REAL_ANDROID_CORE === '1';
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim();
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const HOST = process.env.NATIVE_APP_ANDROID_HOST?.trim();
const BUNDLE_PATH = path.resolve(__dirname, '../../../dist/device-tests/portable-core-webview.js');

test.describe('Android portable core contracts', () => {
  let user: AndroidUser | undefined;

  test.afterEach(async () => {
    await closeAndroidUser(user);
    user = undefined;
  });

  test('runs the same deterministic core cases in the app WebView and embedded Node', async ({}, testInfo) => {
    test.skip(!ENABLED, 'Set E2E_REAL_ANDROID_CORE=1 through npm run test:android:core.');
    test.skip(!ANDROID_SERIAL, 'NATIVE_APP_ANDROID_SERIAL is required.');
    test.skip(!HOST, 'NATIVE_APP_ANDROID_HOST must be the Mac LAN address reachable by the phone.');
    test.skip(
      !(ANDROID_SERIAL && await isAndroidDeviceReady(ANDROID_SERIAL)),
      `Configured adb device ${ANDROID_SERIAL || '(none)'} is unavailable.`,
    );

    user = await launchAndroidUserViaAdb({
      deviceSerial: ANDROID_SERIAL!,
      hubGunUrl: `http://${HOST}:${HUB_GUN_PORT}/gun`,
      enablePortableCoreTests: true,
    });
    const webViewReport = await runPortableCoreOnActor({
      id: ANDROID_SERIAL!,
      runtime: 'android-webview',
      page: user.window,
    }, BUNDLE_PATH);
    const embeddedNode = await user.window.evaluate(async () => {
      const response = await fetch('/api/test/portable-core', { cache: 'no-store' });
      const body = await response.json();
      return { status: response.status, body };
    });
    expect(embeddedNode.status).toBe(200);
    expect(embeddedNode.body.runtime).toBe('embedded-node');
    expect(embeddedNode.body.report.failed).toBe(0);
    expect(embeddedNode.body.report.results.map((result: { id: string }) => result.id)).toEqual(
      webViewReport.results.map((result) => result.id),
    );

    await testInfo.attach('portable-core-report.json', {
      body: Buffer.from(JSON.stringify({
        device: await readAndroidDeviceMetadata(ANDROID_SERIAL!),
        webView: webViewReport,
        embeddedNode,
      }, null, 2)),
      contentType: 'application/json',
    });
    expect(webViewReport.failed).toBe(0);
    expect(webViewReport.passed).toBe(webViewReport.total);
  });
});
