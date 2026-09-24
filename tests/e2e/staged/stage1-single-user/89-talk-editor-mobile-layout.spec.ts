import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Talk editor compact phone layout', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('keeps a simple tag and Create reachable at 390px without losing advanced controls', async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showTalkEditorDialog?.());
    const shell = page.locator('#talk-editor-modal .talk-editor-shell');
    await expect(shell).toBeVisible();

    const shellBox = await shell.boundingBox();
    expect(shellBox).not.toBeNull();
    expect(Math.abs(shellBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(shellBox!.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(shellBox!.width - 390)).toBeLessThanOrEqual(1);
    expect(Math.abs(shellBox!.height - 844)).toBeLessThanOrEqual(1);

    const typeCards = page.locator('.talk-type-option');
    await expect(typeCards).toHaveCount(4);
    const boxes = await typeCards.evaluateAll((cards) => cards.map((card) => {
      const box = card.getBoundingClientRect();
      return { x: box.x, y: box.y, right: box.right };
    }));
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThanOrEqual(1);
    expect(Math.abs(boxes[2].y - boxes[3].y)).toBeLessThanOrEqual(1);
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].right).toBeLessThanOrEqual(390);

    const submit = page.locator('#talk-submit-btn');
    const more = page.locator('#talk-editor-more');
    await expect(submit).toBeVisible();
    await expect(submit).toBeInViewport();
    await expect(more).not.toHaveJSProperty('open', true);
    await expect(page.locator('#talk-is-adult')).toBeHidden();

    const horizontalOverflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - window.innerWidth,
      editor: (() => {
        const editor = document.querySelector('.talk-editor-shell') as HTMLElement;
        return editor.scrollWidth - editor.clientWidth;
      })(),
    }));
    expect(horizontalOverflow.document).toBeLessThanOrEqual(2);
    expect(horizontalOverflow.editor).toBeLessThanOrEqual(2);

    await more.locator(':scope > summary').click();
    await expect(more).toHaveJSProperty('open', true);
    await expect(page.locator('#talk-is-adult')).toBeVisible();
    await expect(submit).toBeInViewport();

    await page.locator('input[name="talk-type-radio"][value="flow"]').check();
    await expect(more).toHaveJSProperty('open', true);
    await expect(page.locator('#questions-form-group')).toBeVisible();
    await expect(submit).toBeInViewport();

    await page.locator('input[name="talk-type-radio"][value="tag"]').check();
    await page.locator('#talk-title').fill('Coffee');
    await submit.click();
    await expect(page.locator('#talk-editor-modal')).toHaveCount(0);
  });
});
