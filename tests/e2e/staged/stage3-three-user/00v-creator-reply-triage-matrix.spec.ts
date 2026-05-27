import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear } from '../../helpers/clear-database';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { afterAction, afterLoad, afterSync } from '../../helpers/timing';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import {
  buildMatrixTalks,
  importChampionReplyMatrixSnapshot,
  type MatrixResponder,
} from '../../helpers/creator-reply-matrix';

/** 100-reply API matrix: peer-routes integration. UI triage uses a smaller in-memory snapshot matrix. */
const MATRIX_SIZE = 6;
const MATRIX_REPLY_COUNT = MATRIX_SIZE * MATRIX_SIZE;
const MATRIX_RESPONDERS: MatrixResponder[] = Array.from({ length: MATRIX_SIZE }, (_, i) => ({
  id: `matrix_responder_${i}`,
  stageName: `Matrix User ${i}`,
}));

test.describe.configure({ timeout: 180_000 });

test.describe('Creator reply triage at scale', () => {
  let browser: Browser;
  let page: Page;

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browser = await chromium.launch();
  });

  test.afterAll(async () => {
    await page?.close();
    await browser?.close();
    await maybeClearGunDatabases();
  });

  test('filters and sorts replies from a seeded multi-user delivery matrix', async () => {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 } });
    page = await context.newPage();
    attachFilteredConsoleLog(page, 'Matrix');
    await injectIdbClear(page);
    await page.goto(webAppURLStableChatroom());
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'Matrix');

    await page.click('.nav-btn[data-view="settings"]');
    await page.fill('#settings-stage-name-input', 'Tom Matrix Creator');
    await page.locator('#settings-stage-name-input').blur();
    await afterSync();

    const tomId = await page.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const tomName = await page.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.stageName);
    const talks = buildMatrixTalks(tomId, MATRIX_SIZE);
    const championIndex = MATRIX_SIZE - 1;
    await importChampionReplyMatrixSnapshot({
      creatorId: tomId,
      creatorName: tomName,
      talks,
      responders: MATRIX_RESPONDERS,
      championIndex,
    });

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await afterSync();

    const summaryNeedle = `(${MATRIX_REPLY_COUNT} total)`;
    await expect
      .poll(async () => page.locator('#creator-replies-summary').innerText(), { timeout: 60_000 })
      .toContain(summaryNeedle);
    await expect(page.locator('#creator-replies-summary')).toContainText('Showing 25 of');
    await page.locator('#reply-load-more').click();
    await expect(page.locator('.creator-reply-row')).toHaveCount(MATRIX_REPLY_COUNT);

    await page.locator('#reply-filter-query').fill(`Matrix User ${championIndex}`);
    await afterSync();
    await expect(page.locator('.creator-reply-row')).toHaveCount(MATRIX_SIZE);
    await expect(page.locator('#creator-replies-active-filters')).toContainText(`Matrix User ${championIndex}`);

    await page.locator('#reply-filter-query').fill('');
    await afterSync();
    await page.locator('#reply-filter-query').fill('Matrix Talk 3');
    await afterSync();
    await expect(page.locator('.creator-reply-row')).toHaveCount(MATRIX_SIZE);

    await page.locator('#reply-clear-filters').click();
    await page.locator('#reply-sort-order').selectOption('matches');
    await afterSync();
    const firstAfterMatchSort = await page.locator('.creator-reply-row').first().innerText();
    expect(firstAfterMatchSort).toContain(`Matrix User ${championIndex}`);

    await page.locator('#reply-sort-order').selectOption('talk-matches');
    await afterSync();
    await expect(page.locator('.creator-reply-row').first()).toContainText('Matrix Talk 0');

    const championScore = MATRIX_SIZE * 100 + MATRIX_SIZE;
    await page.locator('#reply-sort-order').selectOption('weighted');
    await afterSync();
    await expect(page.locator('.creator-reply-row').first()).toContainText(`Score ${championScore}`);

    await page.click('.nav-btn[data-view="settings"]');
    await waitForTabActive(page, 'settings');
    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await expect(page.locator('#reply-sort-order')).toHaveValue('weighted');
    await afterAction();
    await context.close();
  });
});
