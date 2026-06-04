/**
 * Tom broadcasts one talk. Jerry answers the match branch; Bob answers the ignore branch.
 * Verifies: Tom sees exactly 1 match (not 2), Jerry has a conversation with Tom,
 * Bob does NOT appear in Tom's conversation list.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterSync, afterAction } from '../../helpers/timing';
import { launchThreeBrowsers, shutdownThreeBrowsers, type ThreeBrowsers } from '../../helpers/talks-matching-browsers';
import { confirmBroadcastTagPreambleIfVisible } from '../../helpers/broadcast-preamble';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { waitForServerConversations } from '../../helpers/talk-lifecycle-e2e';

import {
  expectActiveTransportMode,
  expectConversationTransportModeForPeer,
} from '../../helpers/p2p-transport-e2e';
import {
  bootstrapUser,
  waitForTabActive,
  waitForResponseModalClosed,
  openIncomingTalkModal,
  resetTalksMatchingSession,
  finalCleanupPages,
} from '../../helpers/talks-matching-flow';

const TALK_TITLE = 'E2E Partial Match Tennis';

test.describe('Talks matching — one match one mismatch from two responders', () => {
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

  test('Jerry matches, Bob mismatches → Tom sees exactly 1 match, no Bob conversation', async () => {
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

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await waitForTabActive(pageTom, 'chatrooms');

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TITLE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want tennis?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await submitTalkEditorAndWaitForOut(pageTom, TALK_TITLE);
    await broadcastFromGlobalChatroom(pageTom);
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    // Jerry answers match
    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageJerry, TALK_TITLE);
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    // Bob answers mismatch
    await pageBob.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await openIncomingTalkModal(pageBob, TALK_TITLE);
    await pageBob.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await afterSync();

    // Tom: confirm conversation exists server-side then inject into browser state.
    await waitForServerConversations(pageTom, 1);
    await waitForServerConversations(pageJerry, 1);
    await expectActiveTransportMode(pageTom, 'direct-p2p');
    await expectActiveTransportMode(pageJerry, 'direct-p2p');
    await expectConversationTransportModeForPeer(pageTom, 'Jerry', 'direct-p2p');
    await expectConversationTransportModeForPeer(pageJerry, 'Tom', 'direct-p2p');
    await expect(pageTom.locator('.nav-btn[data-view="me"] .notification-badge')).toHaveText('1', { timeout: 5_000 });
    await expect
      .poll(
        async () =>
          pageTom.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            const names = Object.values(conversations)
              .filter((conversation: any) => conversation?.supportChannel !== true)
              .map((conversation: any) => conversation?.otherUserName);
            return { count: names.length, hasJerry: names.includes('Jerry'), hasBob: names.includes('Bob') };
          }),
        { timeout: 5_000 },
      )
      .toEqual({ count: 1, hasJerry: true, hasBob: false });

    // Jerry: has conversation with Tom (server returned convId in the HTTP response,
    // so localStorage is already updated before the modal closed)
    await expect
      .poll(
        async () =>
          pageJerry.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            return Object.values(conversations).some((conversation: any) => conversation?.otherUserName === 'Tom');
          }),
        { timeout: 5_000 },
      )
      .toBe(true);
  });
});
