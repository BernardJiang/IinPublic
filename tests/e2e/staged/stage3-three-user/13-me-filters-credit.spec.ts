import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import { gunBaseURL } from '../../helpers/ports';
import {
  bootstrapUser,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
  syncIncomingFromServer,
  waitForResponseModalClosed,
  waitForTabActive,
  waitForIncomingTalkCluster,
  incomingClustersIncludeTitleForUser,
} from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { waitForBroadcastBulkAck } from '../../helpers/broadcast-ack';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function createFlowTalk(page: Page, title: string, question: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(question);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

async function createSurveyTalk(page: Page, title: string, question: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'survey');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(question);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Option A');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('Option B');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('Me tab filters and credit visibility', () => {
  let browsers: ThreeBrowsers;
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
      clearGunForStage3Spec,
    );
    pageTom = pageJerry = pageBob = undefined;
    contextTom = contextJerry = contextBob = undefined;
  });

  test.afterAll(async () => {
    await finalCleanupPages(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
    );
    await shutdownThreeBrowsers(browsers);
    await clearGunForStage3Spec();
  });

  test('Me filters hide disallowed talk types and preserve the credit visibility toggle', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('.settings-talk-filter-type[value="survey"]').uncheck();
    await pageJerry.locator('#settings-credit-visible').uncheck();
    await afterAction();
    await pageJerry.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await expect(pageJerry.locator('#settings-credit-visible')).not.toBeChecked();

    await createFlowTalk(pageTom, 'Filtered Flow Talk', 'Want to play tennis?');
    await createSurveyTalk(pageTom, 'Filtered Survey Talk', 'How was the meetup?');

    await clickBroadcastUntilBulkAck(pageTom);

    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await waitForBroadcastBulkAck(pageTom, { talksSent: 2, receivers: 1 });
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await syncIncomingFromServer(pageJerry);
    await afterSync();

    const jerryUserId = await pageJerry.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    await waitForIncomingTalkCluster(pageJerry, 'Filtered Flow Talk', { timeout: 60_000 });
    await expect
      .poll(
        async () => incomingClustersIncludeTitleForUser(pageJerry, jerryUserId, 'Filtered Survey Talk'),
        { timeout: 20_000, message: 'incoming talks should exclude filtered survey talks' },
      )
      .toBe(false);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await syncIncomingFromServer(pageJerry);
    await afterSync();
    await expect(
      pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: 'Filtered Flow Talk' }).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(pageJerry.locator('.talk-list-item[data-role="incoming"]')).toHaveCount(1, { timeout: 15000 });
    await expect(pageJerry.locator('#talks-list')).not.toContainText('Filtered Survey Talk');

    await openIncomingTalkModal(pageJerry, 'Filtered Flow Talk');
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first().click();
    // contacts-view.ts tap-target split: the row click lands directly on the shared
    // ⟨User⟩ layout (peer-detail) — no DM conversation step to back out of first.
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await pageTom.click('#contact-edit-relationship-btn');
    await expect(pageTom.locator('#contact-relationship-modal')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#contact-relationship-modal')).toContainText('Public credit');
  });
});
