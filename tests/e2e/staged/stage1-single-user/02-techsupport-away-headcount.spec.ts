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
 * docs/TODO.md K1 item 7: with one ordinary user logged in and no TechSupport device process
 * ever started, Global headcount is still 2, the built-in contact is listed, and its presence
 * indicator reads "away" (never "online" — no device announced presence in this test).
 */
test.describe('TechSupport — away headcount with no device running', () => {
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

  test('headcount 2, TechSupport contact listed, away indicator shown everywhere it renders', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');

    // 1. Headcount is exactly 2 (ordinary user + built-in TechSupport) — never 3 (double count)
    // and never 1 (TechSupport missing). No TechSupport client process is ever launched by this
    // test, so this is entirely items 1+2 (client floor + relay seed), not a device announcing.
    const headcount = page.locator('.chatroom-item[data-chatroom-id="global"] .chatroom-headcount');
    await headcount.waitFor({ state: 'visible', timeout: 15000 });
    await expect(headcount).toContainText('2', { timeout: 20000 });

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

    // 3. Global roster row: same built-in member, same away indicator.
    await waitForTabActive(page, 'chatrooms');
    await page.locator('.chatroom-item[data-chatroom-id="global"]').click();
    await afterNav();
    await expect(page.locator('#chatroom-members-list')).toBeVisible({ timeout: 15000 });
    const rosterSupportRow = page.locator('.chatroom-member-item[data-support-contact="true"][data-user-id="' + TECHSUPPORT_ROOT_USER_ID + '"]');
    await expect(rosterSupportRow).toBeVisible({ timeout: 15000 });
    await expect(rosterSupportRow.locator('.techsupport-presence-indicator.away')).toBeVisible();
    await expect(rosterSupportRow.locator('.techsupport-presence-indicator.online')).toHaveCount(0);
  });
});
