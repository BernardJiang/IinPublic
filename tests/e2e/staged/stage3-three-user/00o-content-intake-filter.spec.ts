import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
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

async function createFlowTalk(
  page: Page,
  title: string,
  questionText: string,
  answers: [string, string] = ['Yes', 'No'],
): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const question = page.locator('.question-item').first();
  await question.locator('.question-text').fill(questionText);
  await question.locator('.answer-item').nth(0).locator('.answer-text').fill(answers[0]);
  await question.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await question.locator('.answer-item').nth(1).locator('.answer-text').fill(answers[1]);
  await question.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await submitTalkEditorAndWaitForOut(page, title);
}

async function broadcastFromCurrentRoom(page: Page, previewReason?: RegExp): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  if (previewReason) {
    await page.click('#broadcast-talk-btn');
    const modal = page.locator('[data-testid="broadcast-preamble-modal"]');
    await expect(modal).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => {
        const text = await modal.innerText();
        if (/Preview unavailable/i.test(text)) return null;
        return previewReason.test(text) ? text : null;
      }, { timeout: 45_000 })
      .not.toBeNull();
    await page.locator('[data-testid="broadcast-preamble-cancel"]').click();
    await afterSync();
    return;
  }
  await clickBroadcastUntilBulkAck(page);
  await waitForTabActive(page, 'chatrooms');
}

test.describe('Incoming talk content intake filtering', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry },
      { tom: contextTom, jerry: contextJerry },
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
    await maybeClearGunDatabases();
  });

  test('grammar and content moderation toggles gate delivery and persist disabled state', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Content Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Content Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await expect(pageJerry.locator('#settings-grammar-filter')).toBeChecked();
    await expect(pageJerry.locator('#settings-dirty-words-filter')).toBeChecked();
    await expect(pageJerry.locator('text=Checks titles and question prompts for readable sentence length')).toBeVisible();
    await expect(pageJerry.locator('text=Checks title, questions, and answer choices against an English and Chinese moderation list')).toBeVisible();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-grammar-filter').uncheck();
    await pageJerry.locator('#settings-dirty-words-filter').uncheck();
    await expect
      .poll(() =>
        pageJerry!.evaluate(() => {
          const filters = JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}');
          return [filters.requireGoodGrammar, filters.blockDirtyWords];
        }),
      )
      .toEqual([false, false]);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await expect(pageJerry.locator('#settings-grammar-filter')).not.toBeChecked();
    await expect(pageJerry.locator('#settings-dirty-words-filter')).not.toBeChecked();
    await pageJerry.evaluate(async () => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      if (!app?.currentUser?.id) return;
      const filters = {
        ...JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}'),
        requireGoodGrammar: false,
        blockDirtyWords: false,
      };
      localStorage.setItem('iinpublic_talk_intake_filters', JSON.stringify(filters));
      app.currentUser.talkFilters = filters;
      await app.userService.updateTalkFilters(app.currentUser.id, filters);
    });
    await expect
      .poll(() =>
        pageJerry!.evaluate(async () => {
          const app = (window as any).__iinpublic_app?.getApp?.();
          const userId = app?.currentUser?.id;
          const node = userId ? await app?.gunService?.get?.(`user-talk-filters/${userId}`) : null;
          if (!node?.filtersJson) return null;
          const filters = JSON.parse(node.filtersJson);
          return [filters.requireGoodGrammar, filters.blockDirtyWords];
        }),
        { timeout: 20_000, intervals: [200, 500, 1000] },
      )
      .toEqual([false, false]);
    await afterAction();
  });
});
