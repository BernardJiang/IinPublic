/**
 * Send-My-Talks picker (catalog Part 5, T6 tail; G6).
 *
 * Two matched users: from the shared User layout, open the Send-My-Talks picker,
 * confirm it renders, and close it via Cancel.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterSync } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Send-My-Talks picker', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=1000,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1000,0', '--window-size=800,1100'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastDmPair(pair);
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('opens the picker and cancels', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'SendA', 'SendB');
    const { pageA, userIdB, nameB } = pair;

    // Suppress toasts (the setup match fires Match! notices that intercept clicks)
    // and close the conversation overlay the fast-DM helper leaves open (N2a).
    await pageA.evaluate(() => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.setNotificationsSuppressedForE2e?.(true);
    });
    if (await pageA.locator('#conversation-detail-overlay').isVisible().catch(() => false)) {
      await pageA.click('#back-from-conversation');
      await afterNav();
    }

    await pageA.evaluate(
      ({ id, name }) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser?.(id, name),
      { id: userIdB, name: nameB },
    );
    await afterNav();
    await expect(pageA.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });

    // The picker only opens in MANUAL mode — auto mode sends directly (G6).
    const autoCheckbox = pageA.locator('#peer-auto-mode-checkbox');
    await autoCheckbox.waitFor({ state: 'visible', timeout: 10000 });
    await autoCheckbox.uncheck();
    await afterSync();

    // The send-talks action may be inline or under the ⋯ overflow.
    const sendBtn = pageA.locator('[data-testid="peer-send-talks-btn"], #peer-send-talks-btn');
    if ((await sendBtn.count()) === 0) {
      await pageA.locator('#peer-overflow-btn').click();
      await afterSync();
    }
    await sendBtn.first().click();
    await afterNav();

    await expect(pageA.locator('#peer-send-picker-modal')).toBeVisible({ timeout: 8000 });
    await pageA.locator('[data-testid="cancel-send-picker"], #cancel-send-picker').first().click();
    await afterNav();
    await expect(pageA.locator('#peer-send-picker-modal')).toHaveCount(0);
  });
});
