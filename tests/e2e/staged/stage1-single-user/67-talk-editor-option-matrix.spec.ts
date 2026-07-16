/**
 * Talk Editor — option matrix (catalog Part 5).
 *
 * Single user opens the editor and drives every option surface:
 *   - 4 type radios (tag/flow/survey/route), switching swaps the question area
 *   - 5 expirations, 4 location radii
 *   - Send-to-Chatroom checkbox (create-only), 🔞 adult checkbox
 *   - empty-title validation blocks submit
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

const TYPES = ['tag', 'flow', 'survey', 'route'];
const EXPIRATIONS = ['', '1y', '1M', '1w', '1d'];
const RADII = ['', '10', '100', '1000'];

test.describe('Talk Editor: option matrix', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 1100, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
    // Open the editor programmatically (stable across AppBar overflow states).
    await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog?.());
    await afterNav();
    await page.waitForSelector('#talk-editor-modal');
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('type radios, expirations, radii, checkboxes, and title validation', async () => {
    const p = page!;

    // 4 type radios; route reveals the route editor, others the question container.
    for (const type of TYPES) {
      await p.check(`input[name="talk-type-radio"][value="${type}"]`);
      await afterSync();
      await expect(p.locator(`input[name="talk-type-radio"][value="${type}"]`)).toBeChecked();
      if (type === 'route') {
        await expect(p.locator('#route-form-group')).toBeVisible();
      } else if (type === 'tag') {
        // Tag talks have no question editor — one keyword plus the like-checkbox group.
        await expect(p.locator('#tag-like-group')).toBeVisible();
        await expect(p.locator('#questions-form-group')).toBeHidden();
      } else {
        await expect(p.locator('#questions-form-group')).toBeVisible();
      }
    }

    // 5 expirations.
    for (const value of EXPIRATIONS) {
      await p.selectOption('#talk-expires', value);
      await afterSync();
      await expect(p.locator('#talk-expires')).toHaveValue(value);
    }

    // 4 location radii.
    for (const value of RADII) {
      await p.selectOption('#talk-location-radius', value);
      await afterSync();
      await expect(p.locator('#talk-location-radius')).toHaveValue(value);
    }

    // Checkboxes toggle. Tag talks hide the options groups (minimal editor), so
    // drive the checkboxes on a flow talk where they are visible.
    await p.check('input[name="talk-type-radio"][value="flow"]');
    await afterSync();
    const sendChatroom = p.locator('#talk-send-to-chatroom');
    await expect(sendChatroom).toBeVisible();
    await sendChatroom.uncheck();
    await expect(sendChatroom).not.toBeChecked();
    const adult = p.locator('#talk-is-adult');
    await adult.check();
    await expect(adult).toBeChecked();

    // Validation: empty title blocks submit (modal stays open).
    await p.fill('#talk-title', '');
    await p.locator('#talk-submit-btn').click();
    await afterSync();
    await expect(p.locator('#talk-editor-modal')).toBeVisible();
  });
});
