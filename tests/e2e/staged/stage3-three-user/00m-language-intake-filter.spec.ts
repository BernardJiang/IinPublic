import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  submitTalkEditorAndWaitForOut,
} from '../../helpers/talk-demo-ui';
import { waitForBroadcastBulkAckMinSent } from '../../helpers/broadcast-cancellation-helpers';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function createLanguageTalk(page: Page, title: string, language: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-language', language);
  await page.selectOption('#talk-type', 'flow');
  const question = page.locator('.question-item').first();
  await question.locator('.question-text').fill(`Would you like to discuss ${title}?`);
  await question.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await question.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await question.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await question.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}

async function waitForBroadcastableCount(page: Page, min: number): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const app = (window as unknown as { __iinpublic_app?: { getApp: () => { uiManager?: { getBroadcastableTalkIds?: () => string[] } } } })
            .__iinpublic_app?.getApp?.();
          return app?.uiManager?.getBroadcastableTalkIds?.()?.length ?? 0;
        }),
      { timeout: 10_000, intervals: [100, 200, 400] },
    )
    .toBeGreaterThanOrEqual(min);
}

async function sendBroadcastAndOpenPreview(page: Page, expectedReason?: RegExp): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await waitForBroadcastableCount(page, 1);
  await page.click('#broadcast-talk-btn');
  const modal = page.locator('[data-testid="broadcast-preamble-modal"]');
  await expect(modal).toBeVisible({ timeout: 60_000 });
  if (expectedReason) {
    await expect
      .poll(async () => {
        const text = await modal.innerText();
        if (/Preview unavailable/i.test(text)) return null;
        return expectedReason.test(text) ? text : null;
      }, { timeout: 45_000 })
      .not.toBeNull();
  }
}

test.describe('Incoming talk language intake filtering', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async () => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
      clearGunForStage3Spec,
    );
    pageTom = pageJerry = undefined;
    contextTom = contextJerry = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('allows English and Chinese, hides Spanish, then accepts Spanish after opt-in', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Language Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Language Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('.settings-filter-language-option[value="zh"]').check();
    await expect(pageJerry.locator('.settings-filter-language-option[value="en"]')).toBeChecked();
    await expect(pageJerry.locator('.settings-filter-language-option[value="zh"]')).toBeChecked();
    await expect(pageJerry.locator('.settings-filter-language-option[value="es"]')).not.toBeChecked();
    await expect(pageJerry.locator('#settings-filter-languages-count')).toContainText('2 active');
    await afterAction();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('.settings-filter-language-option[value="es"]').check();
    await expect(pageJerry.locator('#settings-filter-languages-count')).toContainText('3 active');
    await expect
      .poll(
        () =>
          pageJerry!.evaluate(async () => {
            const app = (window as any).__iinpublic_app?.getApp?.();
            const userId = app?.currentUser?.id;
            const node = userId ? await app?.gunService?.get?.(`user-talk-filters/${userId}`) : null;
            if (!node?.filtersJson) return [];
            return JSON.parse(node.filtersJson).allowedLanguages || [];
          }),
        { timeout: 20_000, intervals: [200, 500, 1000] },
      )
      .toEqual(expect.arrayContaining(['en', 'zh', 'es']));
  });
});
