import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterNav, afterSync } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { waitForBroadcastBulkAck } from '../../helpers/broadcast-ack';
import {
  bootstrapUser,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
  syncIncomingFromServer,
  waitForResponseModalClosed,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import { createSimpleFlowTalk } from '../../helpers/broadcast-cancellation-helpers';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

async function getMyTalkIdByTitle(page: Page, title: string): Promise<string> {
  return page.evaluate((needle) => {
    const raw = localStorage.getItem('myTalks');
    const myTalks = raw ? (JSON.parse(raw) as Record<string, any>) : {};
    return Object.entries(myTalks).find(([, talk]) => talk?.title === needle)?.[0] ?? '';
  }, title);
}

async function broadcastFromChatroom(page: Page, talksSent: number): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await afterNav();
  await page.click('#broadcast-talk-btn');
  await confirmBroadcastTagPreambleIfVisible(page);
  await afterAction();
  await waitForTabActive(page, 'chatrooms');
  await waitForBroadcastBulkAck(page, { talksSent, receivers: 1 });
}

test.describe('Chatrooms and Talks UI regressions', () => {
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

  test.beforeAll(async () => {
    await maybeClearGunDatabases();
    browsers = await launchThreeBrowsers();
    browserTom = browsers.tom;
    browserJerry = browsers.jerry;
    browserBob = browsers.bob;
  });

  test.beforeEach(async () => {
    await resetTalksMatchingSession(
      { tom: pageTom, jerry: pageJerry, bob: pageBob },
      { tom: contextTom, jerry: contextJerry, bob: contextBob },
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
    await maybeClearGunDatabases();
  });

  test('chatroom headcounts keep updating across room switches and Return Home refreshes the open detail view', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Headcount');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Headcount');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await expect(pageTom.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('3', {
      timeout: 30_000,
    });

    await pageTom.click('.chatroom-item:has-text("North America")');
    await afterSync();
    await pageTom.click('#back-to-chatrooms');
    await afterSync();
    await expect(pageTom.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('2', {
      timeout: 30_000,
    });

    await pageTom.click('.chatroom-item:has-text("North America")');
    await afterSync();
    await pageTom.click('#return-home-btn');
    await afterSync();
    await expect(pageTom.locator('#current-chatroom-title')).toContainText('San Diego', { timeout: 45_000 });
    await expect(pageTom.locator('#current-chatroom-status')).toContainText(/1 member total/, { timeout: 45_000 });

    await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.());
    await expect(pageTom.locator('#current-chatroom-status')).toContainText(/1 member total/, { timeout: 45_000 });
  });

  test('first Chatrooms screen hydrates existing room headcounts before entering detail', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom First Screen');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry First Screen');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob First Screen');
    contextBob = bob.context;
    pageBob = bob.page;

    await expect(pageBob.locator('#chatroom-list-container')).toBeVisible();
    await expect(pageBob.locator('#chatroom-detail-container')).toBeHidden();
    await expect(pageBob.locator('.chatroom-item:has-text("Global") .chatroom-headcount')).toContainText('4', {
      timeout: 45_000,
    });

    await pageBob.click('.chatroom-item:has-text("Global")');
    await expect(pageBob.locator('#current-chatroom-status')).toContainText(/4 members total/, {
      timeout: 45_000,
    });
  });

  test('Talks rows expose new/answered and broadcasting states without redundant edit controls', async () => {
    const copiedTitle = 'UI Regression Copied Talk';

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Talks UI');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Talks UI');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await createSimpleFlowTalk(pageTom, copiedTitle, 'Yes copy me', 'No thanks', { sendToChatroom: false });
    await broadcastFromChatroom(pageTom, 1);

    await pageJerry.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(pageJerry, 'talks');
    await syncIncomingFromServer(pageJerry);
    const incomingCopied = pageJerry.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: copiedTitle }).first();
    await expect(incomingCopied).toBeVisible({ timeout: 30_000 });
    await expect(incomingCopied).toHaveClass(/talk-incoming-new/);

    await openIncomingTalkModal(pageJerry, copiedTitle);
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes copy me"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    const copiedId = await getMyTalkIdByTitle(pageJerry, copiedTitle);
    expect(copiedId).toBeTruthy();
    await pageJerry.click('#talks-nav-out');
    await afterSync();
    const copiedOut = pageJerry.locator('.talk-list-item[data-role="copied"]').filter({ hasText: copiedTitle }).first();
    await expect(copiedOut).toBeVisible({ timeout: 30_000 });
    await expect(copiedOut).toHaveClass(/talk-broadcast-enabled/);
    await expect(copiedOut.locator('.talk-badge-broadcast-enabled, .talk-badge-broadcast-disabled')).toHaveCount(0);
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toContainText('Broadcast On');
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toHaveAttribute('data-broadcast-enabled', 'true');
    await expect(copiedOut.locator('.edit-talk-btn')).toHaveCount(0);

    await copiedOut.locator('.talk-broadcast-toggle-btn').click();
    await expect(copiedOut).toHaveClass(/talk-broadcast-disabled/);
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toContainText('Broadcast Off');
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toHaveAttribute('data-broadcast-enabled', 'false');

    await copiedOut.locator('.talk-broadcast-toggle-btn').click();
    await expect(copiedOut).toHaveClass(/talk-broadcast-enabled/);
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toContainText('Broadcast On');
    await expect(copiedOut.locator('.talk-broadcast-toggle-btn')).toHaveAttribute('data-broadcast-enabled', 'true');

    await copiedOut.click();
    await expect(pageJerry.locator('#talk-editor-modal')).toBeVisible({ timeout: 15_000 });
    await pageJerry.locator('#cancel-talk-btn').click();
    await pageJerry.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 10_000 });
  });

  test('Ignored incoming talks do not copy and old talks open without an Edit button', async () => {
    const ignoredTitle = 'UI Regression Ignored Talk';

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Ignore UI');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Ignore UI');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await createSimpleFlowTalk(pageTom, ignoredTitle, 'Yes please', 'Ignore this copy', { sendToChatroom: false });
    await broadcastFromChatroom(pageTom, 1);
    await openIncomingTalkModal(pageJerry, ignoredTitle);
    await pageJerry
      .locator('input.choice-radio[data-answer-text="Ignore this copy"][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    await pageJerry.click('#talks-nav-out');
    await afterSync();
    await expect(pageJerry.locator('.talk-list-item[data-role="copied"]').filter({ hasText: ignoredTitle })).toHaveCount(0);
    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterSync();
    await expect(pageJerry.locator('#answers-content').getByText(ignoredTitle).first()).toBeVisible({ timeout: 30_000 });
    await expect(pageJerry.locator('#answers-content').locator('.answer-edit-talk-btn')).toHaveCount(0);
  });
});
