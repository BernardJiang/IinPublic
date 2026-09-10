/**
 * X4 (nightly) — mobile-profile ↔ desktop-app matching + threads; narrow overlay live.
 *
 * Standing in for a real mobile device the same way X1/X2 stand in for
 * website/webapp (browser context = platform): B bootstraps on a 390×844 mobile
 * viewport (`bootstrapMobileUser`/`setupFastMatchedMobileDm`, the same helper
 * `staged/stage2-two-user/38-39` already use), A is an ordinary desktop client,
 * both on the shared per-worker hub. Spec 39 already proves the conversation
 * overlay itself stays usable at 390px; this spec's own contribution is proving
 * the narrow client can leave that overlay and use the main AppBar/bottom-nav
 * afterward — the T1/T2 contract platform-smoke asserts for the iphone-webkit
 * device-profile project, exercised here after a real cross-client match+thread
 * instead of a single idle client.
 */
import { chromium, Browser } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { headless, afterNav } from '../helpers/timing';
import {
  setupFastMatchedMobileDm,
  teardownFastMobileDmPair,
  FastMobileDmPair,
  MOBILE_VIEWPORT,
} from '../helpers/mobile-bootstrap';
import { sendConversationMessage, waitForMessageVisible } from '../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

test.describe('X4: mobile ↔ desktop matching + threads', () => {
  let browserDesktop: Browser;
  let browserMobile: Browser;
  let pair: FastMobileDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserDesktop = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=900,1100'] });
    browserMobile = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=900,0', '--window-size=420,900'] });
  });

  test.afterAll(async () => {
    if (pair) await teardownFastMobileDmPair(pair);
    await browserDesktop?.close().catch(() => {});
    await browserMobile?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('match and per-talk thread replies across a mobile profile and desktop app', async () => {
    pair = await setupFastMatchedMobileDm(browserDesktop, browserMobile, 'X4-Desktop', 'X4-Mobile');
    const { pageA: pageDesktop, pageB: pageMobile, conversationId, userIdA: userIdDesktop, userIdB: userIdMobile } = pair;

    const desktopMessage = `desktop-to-mobile-${Date.now()}`;
    const mobileMessage = `mobile-to-desktop-${Date.now()}`;

    await sendConversationMessage(pageDesktop, conversationId, userIdDesktop, desktopMessage);
    await waitForMessageVisible(pageMobile, desktopMessage, 30_000);

    await sendConversationMessage(pageMobile, conversationId, userIdMobile, mobileMessage);
    await waitForMessageVisible(pageDesktop, mobileMessage, 30_000);

    for (const page of [pageDesktop, pageMobile]) {
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: desktopMessage })).toHaveCount(1);
      await expect(page.locator('#conversation-messages .message-text').filter({ hasText: mobileMessage })).toHaveCount(1);
    }

    // Leave the conversation overlay and confirm the narrow (390px) mobile client's
    // main AppBar/bottom-nav is still fully usable: no horizontal clipping, and the
    // create-talk action reachable either inline or behind the ⋯ overflow button.
    await pageMobile.locator('#back-from-conversation').click();
    await afterNav();
    await expect(pageMobile.locator('#conversation-detail-overlay')).toBeHidden({ timeout: 10_000 });

    await pageMobile.locator('.nav-btn[data-view="chatrooms"]').click();
    await afterNav();
    await expect(pageMobile.locator('#chatrooms-view')).toBeVisible({ timeout: 15_000 });
    await expect(pageMobile.locator('.bottom-nav')).toBeVisible();

    const overflowPx = await pageMobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflowPx, 'mobile client horizontal overflow').toBeLessThanOrEqual(2);

    const createInline = await pageMobile.locator('[data-testid="create-talk-btn"]:visible').count();
    if (createInline === 0) {
      const overflowBtn = pageMobile.locator('[data-testid="app-bar-overflow-btn"]:visible');
      await expect(overflowBtn).toHaveCount(1);
      await overflowBtn.first().click();
      await afterNav();
      expect(
        await pageMobile.locator('[data-testid="create-talk-btn-overflow"], [data-testid="create-talk-btn"]').count(),
      ).toBeGreaterThan(0);
      await pageMobile.keyboard.press('Escape').catch(() => {});
    }

    // Sanity: still the mobile viewport this whole time.
    expect(pageMobile.viewportSize()).toEqual(MOBILE_VIEWPORT);
  });
});
