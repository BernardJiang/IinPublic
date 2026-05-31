import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterSync } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { gunBaseURL } from '../../helpers/ports';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  syncIncomingFromServer,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function broadcastFromCurrentRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await clickBroadcastUntilBulkAck(page);
  await waitForTabActive(page, 'chatrooms');
}

async function createTagTalk(page: Page, title: string): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterSync();
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await selectTalkEditorType(page, 'tag');
  await page.fill('#talk-title', title);
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Incoming talk type intake filtering', () => {
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

  test('allows flow talks while rejecting tag talks when only flow is enabled', async () => {
    test.setTimeout(360_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Type Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Type Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    for (const type of ['survey', 'tag', 'route'] as const) {
      await pageJerry.locator(`.settings-talk-filter-type[value="${type}"]`).uncheck();
    }
    await expect(pageJerry.locator('.settings-talk-filter-type[value="flow"]')).toBeChecked();
    await pageJerry.evaluate(async () => {
      const app = (window as any).__iinpublic_app.getApp();
      await app.userService.updateTalkFilters(app.currentUser.id, app.currentUser.talkFilters);
    });
    await expect
      .poll(() =>
        pageJerry!.evaluate(() =>
          JSON.parse(localStorage.getItem('iinpublic_talk_intake_filters') || '{}').allowedTalkTypes,
        ),
      )
      .toEqual(['flow']);
    await afterAction();

    const tagTitle = 'Type Intake Tag Rejected';
    await createTagTalk(pageTom, tagTitle);

    const senderId = await pageTom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const receiverId = await pageJerry.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    await expect
      .poll(async () => {
        const res = await pageTom!.request.post(`${gunBaseURL()}/api/talks/broadcast-receiver-preview`, {
          data: {
            senderId,
            receiverIds: [receiverId],
            talkData: {
              title: tagTitle,
              authorId: senderId,
              type: 'tag',
              language: 'en',
              questions: [{ text: 'Tag?', answers: [{ text: 'Interested' }, { text: 'Skip' }] }],
              createdAt: new Date().toISOString(),
            },
          },
        });
        if (!res.ok()) return 0;
        const preview = (await res.json()) as { rejectedByCounts?: Record<string, number> };
        return preview.rejectedByCounts?.intake_talk_type || 0;
      })
      .toBe(1);

    await broadcastFromCurrentRoom(pageTom);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(pageJerry.locator('#talks-list')).not.toContainText(tagTitle);
  });
});
