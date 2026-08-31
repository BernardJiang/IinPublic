import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction } from '../../helpers/timing';
import {
  bootstrapUser,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import { ensureChatroomList } from '../../helpers/chatroom-nav';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function createSimpleFlowTalk(page: Page, title: string, question: string): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  const q = page.locator('.question-item').first();
  await q.locator('.question-text').fill(question);
  await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets do it.');
  await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
  await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
  await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  await page.click('#talk-editor-form button[type="submit"]');
  await afterSync();
}

test.describe('UX polish: contacts, talks navigation, and answers details', () => {
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

  test('contacts include mismatched peers, contacts/chatroom open the same peer detail, talks nav splits IN and OUT, and answers show question plus answer', async () => {
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

    await createSimpleFlowTalk(pageTom, 'Tom Out Talk', 'Do you want to join Tom?');
    await createSimpleFlowTalk(pageJerry, 'Jerry Out Talk', 'Do you want to join Jerry?');

    await clickBroadcastUntilBulkAck(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await clickBroadcastUntilBulkAck(pageJerry);
    await afterAction();
    await waitForTabActive(pageJerry, 'chatrooms');

    await openIncomingTalkModal(pageJerry, 'Tom Out Talk');
    await pageJerry
      .locator('input.choice-radio[data-answer-text="No thanks."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const contactItem = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry' }).first();
    await expect(contactItem).toBeVisible({ timeout: 15000 });
    await expect
      .poll(async () => (await contactItem.textContent()) || '', {
        timeout: 15_000,
        message: 'Jerry contact should show either one-way or reconciled P2P talk accounting',
      })
      .toMatch(/(?:1 talk|2 talks)[\s\S]*Sent 1 · Received [01]/);
    await contactItem.click();
    // contacts-view.ts tap-target split: the row click lands directly on the shared
    // ⟨User⟩ layout (peer-detail) — no DM conversation step to back out of first.
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await afterSync();
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('.peer-history-item').filter({ hasText: 'Tom Out Talk' }).first()).toBeVisible({ timeout: 30000 });
    await pageTom.click('#back-from-peer-detail');
    await afterAction();

    await ensureChatroomList(pageTom);
    await pageTom.click('.chatroom-item[data-chatroom-id="global"]');
    await afterSync();
    const jerryMember = pageTom.locator('.chatroom-member-item').filter({ hasText: 'Jerry' }).first();
    await expect(jerryMember).toBeVisible({ timeout: 15000 });
    await jerryMember.click();
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10000 });
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry');
    await pageTom.click('#back-from-peer-detail');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageTom.locator('#talks-filter-incoming')).toBeVisible();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');

    await pageTom.locator('#talks-filter-outgoing').uncheck();
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');
    await expect(pageTom.locator('#talks-list')).not.toContainText('Tom Out Talk');

    await pageTom.locator('#talks-filter-outgoing').check();
    await pageTom.locator('#talks-filter-incoming').uncheck();
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).not.toContainText('Jerry Out Talk');

    await pageTom.locator('#talks-filter-incoming').check();
    await afterSync();
    await expect(pageTom.locator('#talks-list')).toContainText('Tom Out Talk');
    await expect(pageTom.locator('#talks-list')).toContainText('Jerry Out Talk');

    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterSync();
    const answersContent = pageJerry.locator('#answers-content');
    // docs/TODO.md §LL.2 follow-up: the Me tab shows the question and answer directly, not the
    // source talk's title or outcome — locate the row by its prompt text instead.
    const answerRow = answersContent.locator('.answer-talk-item').filter({ hasText: 'Do you want to join Tom?' }).first();
    await expect(answerRow).toBeVisible({ timeout: 15000 });
    await expect(answerRow).toHaveAttribute('data-outcome', 'mismatch');
    await expect(answerRow.getByText('No thanks.').first()).toBeVisible({ timeout: 10000 });
  });
});
