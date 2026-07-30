import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {maybeClearGunDatabases, injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Tab sweep smoke (D6)', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browser = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    await page?.close();
    await browser?.close();
    await maybeClearGunDatabases();
  });

  test('exposes reply triage, OUT sort, and settings filter diagnostics on main tabs', async () => {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    attachFilteredConsoleLog(page, 'Sweep');
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'Sweep');

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', 'Tab Sweep User');
    await page.locator('#settings-stage-name-input').blur();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();

    await page.click('.nav-btn[data-view="talks"]');
    await afterNav();
    // TODO §M1: "Replies To My Talks" panel is hidden for now.
    await expect(page.locator('#creator-replies-panel')).toBeHidden();
    await expect(page.locator('#talks-out-sort-order option[value="weighted"]')).toHaveText('Weighted performance');

    await page.click('.nav-btn[data-view="contacts"]');
    await afterNav();
    await page.click('[data-testid="contacts-filter-toggle"]');
    await expect(page.locator('#contacts-filter-relation')).toBeVisible();
    await expect(page.locator('#contacts-sort-order option[value="weighted"]')).toHaveText(/Relevance score|Weighted/i);

    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.click('[data-testid="me-filter-toggle"]');
    await expect(page.locator('.me-talk-type-filter[data-me-talk-type="tag"]')).toBeVisible();
    await expect(page.locator('.me-talk-type-filter[data-me-talk-type="route"]')).toBeVisible();
    await expect(page.locator('.me-tag-state-checkbox[value="indeterminate"]')).toBeVisible();

    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(page.locator('#settings-filtered-incoming-summary')).toBeVisible();
    await expect(page.locator('#settings-grammar-filter')).toBeVisible();
    await expect(page.locator('#settings-ui-language')).toBeVisible();
  });
});
