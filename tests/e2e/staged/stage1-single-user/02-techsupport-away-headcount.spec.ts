import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

/**
 * OPEN-40 Contacts-only migration: with one ordinary user logged in and no TechSupport device
 * process ever started, Nearby headcount is 1, the built-in Contact is listed as away, and
 * TechSupport never appears in the room roster.
 */
test.describe('TechSupport — Contacts-only and away with no device running', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('Nearby counts only the user while the TechSupport Contact remains listed as away', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');

    // 1. TechSupport is not a synthetic room member or headcount floor.
    const headcount = page.locator('.chatroom-item.current-room .chatroom-headcount');
    await headcount.waitFor({ state: 'visible', timeout: 15000 });
    await expect(headcount).toContainText('1', { timeout: 20000 });

    // 2. Contacts tab: the built-in support contact is listed, and its presence indicator
    // reads away — settled, not a transient "checking" state (defaults to away, only flips on
    // a positive presence signal, which never arrives here).
    await waitForTabActive(page, 'contacts');
    const contactsSupportRow = page.locator('.contact-item[data-support-contact="true"][data-contact-user-id="' + TECHSUPPORT_ROOT_USER_ID + '"]');
    await expect(contactsSupportRow).toBeVisible({ timeout: 15000 });
    await expect.poll(
      () => contactsSupportRow.locator('.techsupport-presence-indicator').getAttribute('data-techsupport-online'),
      { timeout: 10_000 },
    ).toBe('false');
    await expect(contactsSupportRow.locator('.techsupport-presence-indicator.away')).toBeVisible();
    await expect(contactsSupportRow.locator('.techsupport-presence-indicator.online')).toHaveCount(0);

    // 3. Room roster: TechSupport is absent because support is a Contact, not a participant.
    await waitForTabActive(page, 'chatrooms');
    await page.locator('.chatroom-item.current-room').click();
    await afterNav();
    await expect(page.locator('#chatroom-members-list')).toBeVisible({ timeout: 15000 });
    const rosterSupportRow = page.locator('.chatroom-member-item[data-support-contact="true"][data-user-id="' + TECHSUPPORT_ROOT_USER_ID + '"]');
    await expect(rosterSupportRow).toHaveCount(0);
  });
});
