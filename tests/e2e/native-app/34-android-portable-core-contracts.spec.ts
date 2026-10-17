import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  closeAndroidUser,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  readAndroidDeviceMetadata,
  type AndroidUser,
} from './helpers/native-app-android';
import { runPortableCoreOnActor, runPortableJestOnActor, type PortableJestReport } from '../helpers/portable-core-actor';

const ENABLED = process.env.E2E_REAL_ANDROID_CORE === '1';
const ANDROID_SERIAL = process.env.NATIVE_APP_ANDROID_SERIAL?.trim();
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const HOST = process.env.NATIVE_APP_ANDROID_HOST?.trim();
const BUNDLE_PATH = path.resolve(__dirname, '../../../dist/device-tests/portable-core-webview.js');
// The unit files run unchanged (src/test/support/portable-jest) and the ids the host lane recorded
// for them (scripts/run-portable-jest-host.mjs). A phone must report exactly these ids.
const JEST_BUNDLE_PATH = path.resolve(__dirname, '../../../dist/device-tests/portable-jest-webview.js');
const JEST_IDS_PATH = path.resolve(__dirname, '../../../dist/device-tests/portable-jest-ids.json');

const jestIds = (report: PortableJestReport) => report.reports.flatMap((file) => file.results.map((result) => `${file.file} › ${result.id}`));

function jestFailures(report: PortableJestReport): string {
  return report.reports
    .flatMap((file) => file.results.filter((result) => !result.passed).map((result) => `${file.file} › ${result.id}: ${result.error}`))
    .slice(0, 20)
    .join('\n');
}

test.describe('Android portable core contracts', () => {
  let user: AndroidUser | undefined;

  test.afterEach(async () => {
    await closeAndroidUser(user);
    user = undefined;
  });

  test('runs the same deterministic core cases and unit files in the app WebView and embedded Node', async ({}, testInfo) => {
    // ~1,150 unit tests in each runtime; an Android 7 phone takes about a minute.
    test.setTimeout(10 * 60_000);
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
    // Embedded Node first: the WebView unit bundle loads its own gun into this page.
    const embeddedNode = await user.window.evaluate(async () => {
      const response = await fetch('/api/test/portable-core', { cache: 'no-store' });
      const body = await response.json();
      return { status: response.status, body };
    });
    const webViewJest = await runPortableJestOnActor({
      id: ANDROID_SERIAL!,
      runtime: 'android-webview',
      page: user.window,
    }, JEST_BUNDLE_PATH);
    const expectedJestIds = JSON.parse(await readFile(JEST_IDS_PATH, 'utf8')).ids as string[];

    await testInfo.attach('portable-core-report.json', {
      body: Buffer.from(JSON.stringify({
        device: await readAndroidDeviceMetadata(ANDROID_SERIAL!),
        webView: webViewReport,
        webViewJest,
        embeddedNode,
      }, null, 2)),
      contentType: 'application/json',
    });

    expect(embeddedNode.status).toBe(200);
    expect(embeddedNode.body.runtime).toBe('embedded-node');
    expect(embeddedNode.body.report.failed).toBe(0);
    expect(embeddedNode.body.report.results.map((result: { id: string }) => result.id)).toEqual(
      webViewReport.results.map((result) => result.id),
    );
    expect(webViewReport.failed).toBe(0);
    expect(webViewReport.passed).toBe(webViewReport.total);

    // A null report means the APK was built without the debug device-tests asset.
    const nodeJest = embeddedNode.body.jest as PortableJestReport | null;
    expect(nodeJest, 'embedded Node has no unit bundle: rebuild the debug APK (npm run android:build)').not.toBeNull();
    expect(jestFailures(nodeJest!), `embedded Node failed ${nodeJest!.failed} unit test(s)`).toBe('');
    expect(jestFailures(webViewJest), `the WebView failed ${webViewJest.failed} unit test(s)`).toBe('');
    expect(jestIds(nodeJest!), 'embedded Node ran a different set of unit tests than the host').toEqual(expectedJestIds);
    expect(jestIds(webViewJest), 'the WebView ran a different set of unit tests than the host').toEqual(expectedJestIds);
  });
});
