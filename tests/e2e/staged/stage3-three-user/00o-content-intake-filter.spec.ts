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
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

async function broadcastFromCurrentRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#broadcast-talk-btn');
  await expect(page.locator('[data-testid="broadcast-preamble-modal"]')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-testid="broadcast-preamble-send"]').click();
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

    const cleanTitle = 'Community Reading Meetup';
    await createFlowTalk(pageTom, cleanTitle, 'Would you like to join the reading group this afternoon?');
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, cleanTitle);

    const unreadableText = Array.from({ length: 31 }, () => 'repeat').join(' ');
    const grammarBlockedTitle = `${unreadableText} grammar blocked`;
    await createFlowTalk(pageTom, grammarBlockedTitle, unreadableText);
    await broadcastFromCurrentRoom(pageTom);

    const dirtyBlockedTitle = 'This is SCAM!!!';
    await createFlowTalk(pageTom, dirtyBlockedTitle, 'Would you like to join this community discussion?');
    await broadcastFromCurrentRoom(pageTom);

    const dirtyAnswerBlockedTitle = 'Answer Choice Moderation Blocked';
    await createFlowTalk(
      pageTom,
      dirtyAnswerBlockedTitle,
      'Would you like to join this community discussion?',
      ['Join this SCAM!!!', 'No thank you'],
    );
    await broadcastFromCurrentRoom(pageTom);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(pageJerry.locator('#talks-list')).toContainText(cleanTitle);
    await expect(pageJerry.locator('#talks-list')).not.toContainText(grammarBlockedTitle);
    await expect(pageJerry.locator('#talks-list')).not.toContainText(dirtyBlockedTitle);
    await expect(pageJerry.locator('#talks-list')).not.toContainText(dirtyAnswerBlockedTitle);

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
    await afterAction();

    const grammarAllowedTitle = `${unreadableText} grammar allowed`;
    await createFlowTalk(pageTom, grammarAllowedTitle, unreadableText);
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, grammarAllowedTitle);

    const dirtyAllowedTitle = 'SCAM discussion now permitted';
    await createFlowTalk(pageTom, dirtyAllowedTitle, 'Would you like to join this community discussion?');
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, dirtyAllowedTitle);

    const dirtyAnswerAllowedTitle = 'Answer Choice Moderation Allowed';
    await createFlowTalk(
      pageTom,
      dirtyAnswerAllowedTitle,
      'Would you like to join this community discussion?',
      ['Join this SCAM!!!', 'No thank you'],
    );
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, dirtyAnswerAllowedTitle);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(pageJerry.locator('#talks-list')).toContainText(grammarAllowedTitle);
    await expect(pageJerry.locator('#talks-list')).toContainText(dirtyAllowedTitle);
    await expect(pageJerry.locator('#talks-list')).toContainText(dirtyAnswerAllowedTitle);
  });
});
