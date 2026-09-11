/**
 * Installed macOS Firefox mixed-browser slice.
 *
 * Unlike the ordinary `firefox` project, this launches the stable Firefox.app through
 * WebDriver BiDi. Chromium <-> Firefox and Firefox <-> WebKit each form a real matched
 * thread and deliver messages in both directions against the same isolated local hub.
 */
import { chromium, firefox, webkit, type Browser, type Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import {
  setupFastMatchedDm,
  teardownFastDmPair,
  sendConversationMessage,
  waitForMessageVisible,
  type FastDmPair,
} from '../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

const installedFirefoxExecutable =
  process.env.MACOS_FIREFOX_EXECUTABLE || '/Applications/Firefox.app/Contents/MacOS/firefox';

async function verifyBidirectionalMessages(
  pair: FastDmPair,
  aRuntime: string,
  bRuntime: string,
): Promise<void> {
  const { pageA, pageB, conversationId, userIdA, userIdB } = pair;
  const aMessage = `${aRuntime}-to-${bRuntime}-${Date.now()}`;
  const bMessage = `${bRuntime}-to-${aRuntime}-${Date.now()}`;

  await sendConversationMessage(pageA, conversationId, userIdA, aMessage);
  await waitForMessageVisible(pageB, aMessage, 30_000);

  await sendConversationMessage(pageB, conversationId, userIdB, bMessage);
  await waitForMessageVisible(pageA, bMessage, 30_000);

  for (const page of [pageA, pageB] as Page[]) {
    await expect(page.locator('#conversation-messages .message-text').filter({ hasText: aMessage })).toHaveCount(1);
    await expect(page.locator('#conversation-messages .message-text').filter({ hasText: bMessage })).toHaveCount(1);
  }
}

test.describe('macOS installed Firefox mixed-browser matrix', () => {
  test.skip(!process.env.E2E_MACOS_FIREFOX, 'requires the installed macOS Firefox matrix runner');

  let chromiumBrowser: Browser | undefined;
  let firefoxBrowser: Browser | undefined;
  let webkitBrowser: Browser | undefined;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _workerSlot }) => {
    await clearGunForStage2Spec();
    chromiumBrowser = await chromium.launch({ headless: true, args: WEBRTC_CHROMIUM_ARGS });
    firefoxBrowser = await firefox.launch({
      channel: 'moz-firefox',
      executablePath: installedFirefoxExecutable,
      headless: true,
    });
    webkitBrowser = await webkit.launch({ headless: true });
  });

  test.afterEach(async () => {
    if (pair) await teardownFastDmPair(pair);
    pair = undefined;
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await chromiumBrowser?.close().catch(() => {});
    await firefoxBrowser?.close().catch(() => {});
    await webkitBrowser?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('Chromium <-> installed Firefox forms a match and delivers both directions', async () => {
    test.setTimeout(120_000);
    pair = await setupFastMatchedDm(
      chromiumBrowser!,
      firefoxBrowser!,
      'chromium-alice',
      'firefox-eve',
    );
    await verifyBidirectionalMessages(pair, 'chromium', 'firefox');
  });

  test('installed Firefox <-> WebKit forms a match and delivers both directions', async () => {
    test.setTimeout(120_000);
    pair = await setupFastMatchedDm(
      firefoxBrowser!,
      webkitBrowser!,
      'firefox-eve',
      'webkit-bob',
    );
    await verifyBidirectionalMessages(pair, 'firefox', 'webkit');
  });
});
