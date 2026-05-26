import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
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
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

async function sendBroadcastAndOpenPreview(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#broadcast-talk-btn');
  await expect(page.locator('[data-testid="broadcast-preamble-modal"]')).toBeVisible({ timeout: 60_000 });
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

    const spanishRejectedTitle = 'Language Intake Spanish Rejected';
    await createLanguageTalk(pageTom, spanishRejectedTitle, 'es');

    await sendBroadcastAndOpenPreview(pageTom);
    await pageTom.locator('[data-testid="broadcast-preamble-send"]').click();
    await waitForTabActive(pageTom, 'chatrooms');

    const englishTitle = 'Language Intake English';
    const chineseTitle = 'Language Intake Chinese';
    await createLanguageTalk(pageTom, englishTitle, 'en');
    await createLanguageTalk(pageTom, chineseTitle, 'zh');
    await sendBroadcastAndOpenPreview(pageTom);
    await pageTom.locator('[data-testid="broadcast-preamble-send"]').click();
    await waitForTabActive(pageTom, 'chatrooms');

    await waitForIncomingTalkClusterOnServer(pageJerry, englishTitle);
    await waitForIncomingTalkClusterOnServer(pageJerry, chineseTitle);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(pageJerry.locator('#talks-list')).toContainText(englishTitle);
    await expect(pageJerry.locator('#talks-list')).toContainText(chineseTitle);
    await expect(pageJerry.locator('#talks-list')).not.toContainText(spanishRejectedTitle);

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('.settings-filter-language-option[value="es"]').check();
    await expect(pageJerry.locator('#settings-filter-languages-count')).toContainText('3 active');
    await afterAction();

    const spanishAllowedTitle = 'Language Intake Spanish Allowed';
    await createLanguageTalk(pageTom, spanishAllowedTitle, 'es');
    await sendBroadcastAndOpenPreview(pageTom);
    await pageTom.locator('[data-testid="broadcast-preamble-send"]').click();
    await waitForTabActive(pageTom, 'chatrooms');

    await waitForIncomingTalkClusterOnServer(pageJerry, spanishAllowedTitle);
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(pageJerry.locator('#talks-list')).toContainText(spanishAllowedTitle);
  });
});
