import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterAction, afterNav, afterSync } from '../../helpers/timing';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { broadcastFromGlobalChatroom } from '../../helpers/talk-demo-ui';

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
  await broadcastFromGlobalChatroom(page);
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
    const copiedBroadcastToggle = () =>
      pageJerry.locator(`.talk-broadcast-toggle-btn[data-talk-id="${copiedId}"]`).first();
    const copiedOut = pageJerry.locator('.talk-list-item[data-role="copied"]').filter({ hasText: copiedTitle }).first();
    await expect(copiedOut).toBeVisible({ timeout: 30_000 });
    await expect(copiedOut).toHaveClass(/talk-broadcast-enabled/);
    await expect(copiedOut.locator('.talk-badge-broadcast-enabled, .talk-badge-broadcast-disabled')).toHaveCount(0);
    // TODO §M2: the broadcast toggle is now an icon-only inline button — its label lives in the
    // title attribute, not visible text.
    await expect(copiedBroadcastToggle()).toHaveAttribute('title', 'Broadcast On');
    await expect(copiedBroadcastToggle()).toHaveAttribute('data-broadcast-enabled', 'true');
    await expect(copiedOut.locator('.edit-talk-btn')).toHaveCount(0);

    await copiedBroadcastToggle().dispatchEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    await expect(copiedOut).toHaveClass(/talk-broadcast-disabled/);
    // TODO §M2: the broadcast toggle is now an icon-only inline button — its label lives in the
    // title attribute, not visible text.
    await expect(copiedBroadcastToggle()).toHaveAttribute('title', 'Broadcast Off');
    await expect(copiedBroadcastToggle()).toHaveAttribute('data-broadcast-enabled', 'false');

    await copiedBroadcastToggle().dispatchEvent('mousedown', { button: 0, bubbles: true, cancelable: true });
    await expect(copiedOut).toHaveClass(/talk-broadcast-enabled/);
    await expect(copiedBroadcastToggle()).toHaveAttribute('title', 'Broadcast On');
    await expect(copiedBroadcastToggle()).toHaveAttribute('data-broadcast-enabled', 'true');

    await copiedOut.evaluate((row: HTMLElement) => row.click());
    await expect(pageJerry.locator('#talk-editor-modal')).toBeVisible({ timeout: 15_000 });
    await pageJerry.locator('#cancel-talk-btn').click();
    await pageJerry.waitForSelector('#talk-editor-modal', { state: 'detached', timeout: 10_000 });
  });

  test('auto-copy toggle changes durable state for talks received from another user', async () => {
    const disabledTitle = 'Delivered Auto Copy Disabled';
    const enabledTitle = 'Delivered Auto Copy Enabled';

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Auto Copy Sender');
    contextTom = tom.context;
    pageTom = tom.page;
    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Auto Copy Receiver');
    contextJerry = jerry.context;
    pageJerry = jerry.page;

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-copy-talk-autosave').uncheck();
    await expect.poll(() => pageJerry!.evaluate(() => localStorage.getItem('copyTalkAutoSave'))).toBe('false');

    await createSimpleFlowTalk(pageTom, disabledTitle, 'Match without copy', 'Skip without copy', {
      sendToChatroom: false,
    });
    await createSimpleFlowTalk(pageTom, enabledTitle, 'Match with copy', 'Skip with copy', { sendToChatroom: false });
    await broadcastFromChatroom(pageTom, 2);

    await openIncomingTalkModal(pageJerry, disabledTitle);
    await pageJerry.locator('input.choice-radio[data-answer-text="Match without copy"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();
    expect(
      await pageJerry.evaluate((title) => {
        const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        return Object.values(talks).find((talk: any) => talk?.title === title)?.role || '';
      }, disabledTitle),
    ).toBe('answered');

    await pageJerry.click('.nav-btn[data-view="settings"]');
    await afterSync();
    await pageJerry.locator('#settings-copy-talk-autosave').check();
    await expect.poll(() => pageJerry!.evaluate(() => localStorage.getItem('copyTalkAutoSave'))).toBe('true');

    await openIncomingTalkModal(pageJerry, enabledTitle);
    await pageJerry.locator('input.choice-radio[data-answer-text="Match with copy"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    await pageJerry.click('#talks-nav-out');
    await afterSync();
    await expect(pageJerry.locator('.talk-list-item[data-role="copied"]').filter({ hasText: disabledTitle })).toHaveCount(0);
    await expect(pageJerry.locator('.talk-list-item[data-role="copied"]').filter({ hasText: enabledTitle })).toBeVisible({
      timeout: 30_000,
    });
    const storedOutcome = await pageJerry.evaluate((titles) => {
      const talks = Object.values(JSON.parse(localStorage.getItem('myTalks') || '{}')) as any[];
      const history = Object.values(JSON.parse(localStorage.getItem('myAnswerHistory') || '{}')) as any[];
      return {
        enabledRole: talks.find((talk) => talk?.title === titles.enabled)?.role || '',
        historyTitles: history.map((record) => record?.title || ''),
      };
    }, { disabled: disabledTitle, enabled: enabledTitle });
    expect(storedOutcome.enabledRole).toBe('copied');
    expect(storedOutcome.historyTitles).toEqual(expect.arrayContaining([disabledTitle, enabledTitle]));
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
