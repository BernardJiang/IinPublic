import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { waitForBroadcastBulkAck } from '../../helpers/broadcast-ack';
import { gunBaseURL } from '../../helpers/ports';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForIncomingTalkClusterOnServer,
  waitForTabActive,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function createFlowTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
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

async function broadcastFromCurrentRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await clickBroadcastUntilBulkAck(page);
  await waitForTabActive(page, 'chatrooms');
}

async function waitForPreviewRejection(
  senderPage: Page,
  receiverPage: Page,
  title: string,
  reason: string,
): Promise<void> {
  const senderId = await senderPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
  const receiverId = await receiverPage.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
  await expect
    .poll(async () => {
      const response = await senderPage.request.post(`${gunBaseURL()}/api/talks/broadcast-receiver-preview`, {
        data: {
          senderId,
          receiverIds: [receiverId],
          talkData: {
            title,
            authorId: senderId,
            type: 'flow',
            language: 'en',
            createdAt: new Date().toISOString(),
            questions: [{ text: `Would you like to discuss ${title}?`, answers: [{ text: 'Yes' }, { text: 'No' }] }],
          },
        },
      });
      if (!response.ok()) return 0;
      const preview = await response.json() as { rejectedByCounts?: Record<string, number> };
      return preview.rejectedByCounts?.[reason] || 0;
    })
    .toBe(1);
}

async function expectIncomingExcludes(page: Page, title: string): Promise<void> {
  const receiverId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
  expect(await incomingClustersIncludeTitleForUser(page, receiverId, title)).toBe(false);
}

test.describe('Incoming talk custom phrase and cutoff filtering', () => {
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

  test('custom phrase and sent-after settings reject delivery until each control is cleared', async () => {
    test.setTimeout(360_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Cutoff Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Cutoff Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-custom-blocked').fill('eclipse invitation');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() =>
          JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').customBlockedTerms,
        ),
      )
      .toEqual(['eclipse invitation']);

    const phraseBlockedTitle = 'Eclipse Invitation Blocked';
    await waitForPreviewRejection(pageTom, pageJerry, phraseBlockedTitle, 'intake_custom_blocked_terms');
    await createFlowTalk(pageTom, phraseBlockedTitle);
    await broadcastFromCurrentRoom(pageTom);
    await waitForBroadcastBulkAck(pageTom, { talksSent: 1, receivers: 1 });
    await expectIncomingExcludes(pageJerry, phraseBlockedTitle);

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-custom-blocked').fill('');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() =>
          JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').customBlockedTerms,
        ),
      )
      .toEqual([]);
    const phraseAllowedTitle = 'Eclipse Invitation Allowed';
    await createFlowTalk(pageTom, phraseAllowedTitle);
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, phraseAllowedTitle);

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-sent-after').fill('2099-01-01T00:00');
    await pageJerry.locator('#settings-sent-after').press('Tab');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() =>
          JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').sentAfter,
        ),
      )
      .toContain('2099-01-01T');
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await expect(pageJerry.locator('#settings-sent-after')).toHaveValue('2099-01-01T00:00');
    await afterAction();

    const cutoffBlockedTitle = 'Cutoff Delivery Blocked';
    await waitForPreviewRejection(pageTom, pageJerry, cutoffBlockedTitle, 'intake_sent_after');
    await createFlowTalk(pageTom, cutoffBlockedTitle);
    await broadcastFromCurrentRoom(pageTom);
    await waitForBroadcastBulkAck(pageTom, { talksSent: 3, receivers: 1 });
    await expectIncomingExcludes(pageJerry, cutoffBlockedTitle);

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-sent-after').fill('');
    await pageJerry.locator('#settings-sent-after').press('Tab');
    await expect
      .poll(() =>
        pageJerry!.evaluate(() =>
          JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').sentAfter,
        ),
      )
      .toBeUndefined();
    const cutoffAllowedTitle = 'Cutoff Delivery Allowed';
    await createFlowTalk(pageTom, cutoffAllowedTitle);
    await broadcastFromCurrentRoom(pageTom);
    await waitForIncomingTalkClusterOnServer(pageJerry, cutoffAllowedTitle);
  });
});
