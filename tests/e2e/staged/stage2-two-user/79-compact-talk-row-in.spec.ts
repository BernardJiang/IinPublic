/**
 * TODO §M2 (IN row): an incoming talk row collapses to 2 visible lines (title+badges, a status
 * line with the clickable sender-name and inline View/Details icons) with the chip row (progress/
 * language/expiry/location/distance/response) and relative-time meta moved into a hidden
 * .talk-item-details, opened on demand via the "ℹ️" icon. The sender-name itself stays visible
 * on the row (not moved into the popup) since it's the interactive N3 click-to-DM traceback
 * affordance (item 6/8), not decorative detail. The View icon still opens the response flow on a
 * single click, with no prior row-selection step.
 */
import { chromium, Browser, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterSync } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

async function createSimpleFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await selectTalkEditorType(page, 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill('IN row compaction smoke?');
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Compact talk rows (M2) — IN row 2-line collapse + popup details', () => {
  let browserA: Browser;
  let browserB: Browser;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100'] });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('IN row: 2 visible lines, sender stays visible, chips/meta in popup, View icon acts on first click', async () => {
    const tom = await bootstrapUser(browserA, 'CompactRowTom', 'CompactRowTom');
    const jerry = await bootstrapUser(browserB, 'CompactRowJerry', 'CompactRowJerry');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      await createSimpleFlowTalk(pageTom, 'M2 IN row compaction talk');
      const delivery = await pageTom.evaluate(async () => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        return app.deliverPendingBroadcastTalksForE2e(1);
      });
      expect(delivery).toMatchObject({ talksSent: 1, receivers: 1 });

      await pageJerry.click('.nav-btn[data-view="talks"]');
      await waitForTabActive(pageJerry, 'talks');
      await afterSync();

      const row = pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'M2 IN row compaction talk' });
      await expect(row).toBeVisible({ timeout: 15_000 });

      // Exactly 2 visible lines: header + status-line (sender + inline icons). Details hidden.
      await expect(row.locator('.talk-item-header')).toBeVisible();
      await expect(row.locator('.talk-item-status-line')).toBeVisible();
      await expect(row.locator('.talk-sender-people')).toBeVisible();
      await expect(row.locator('.talk-item-details')).toBeHidden();
      await expect(row.locator('.talk-item-actions')).toHaveCount(0);

      // Details popup shows the chip row and meta that used to render inline on the row.
      await row.locator('.talk-details-btn').click();
      const popup = pageJerry.locator('#item-details-popup');
      await expect(popup).toBeVisible({ timeout: 10_000 });
      await expect(popup.locator('.talk-info-chips')).toBeVisible();
      await popup.locator('#close-item-details-popup').click();
      await expect(popup).toHaveCount(0);
      await expect(row.locator('.talk-item-details')).toBeHidden();

      // View icon: single click opens the response flow directly, no prior selection step.
      await row.locator('.view-talk-btn').click();
      await expect(pageJerry.locator('#talk-response-modal')).toBeVisible({ timeout: 10_000 });
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });
});
