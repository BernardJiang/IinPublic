/**
 * Phase D4 — flow talk: one match and one mismatch responder; OUT/IN, Contacts, Me, conversations.
 */
import { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync } from '../../helpers/timing';
import {
  clickBroadcastUntilBulkAck,
  createTalksFromCompanyPage,
  completeTalkInAppByAnswerIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast } from '../../helpers/durable-ui';
import {
  expectActiveTransportMode,
  expectConversationTransportModeForPeerId,
} from '../../helpers/p2p-transport-e2e';
import { waitForServerConversations } from '../../helpers/talk-lifecycle-e2e';
import {
  buildFlowTalkPayload,
  flowMatchAnswerIds,
  flowIgnoreAnswerIds,
  LIFECYCLE_FLOW_MATCH_TEXT,
  LIFECYCLE_FLOW_IGNORE_TEXT,
} from '../../helpers/talk-lifecycle-fixtures';
import {
  bootstrapUser,
  finalCleanupPages,
  resetTalksMatchingSession,
  waitForTabActive,
} from '../../helpers/talks-matching-flow';
import {
  launchThreeBrowsers,
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../../helpers/talks-matching-browsers';

const FLOW_TITLE = 'Lifecycle Matrix Flow';

test.describe('Talk lifecycle — flow multi-responder matrix (D4)', () => {
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

  test('match and mismatch responders stay isolated across conversations, contacts, and Me', async () => {
    test.setTimeout(420_000);
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom Matrix');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry Matrix');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob Matrix');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const tomId = await pageTom.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    const [created] = await createTalksFromCompanyPage(pageTom, [
      buildFlowTalkPayload(tomId, FLOW_TITLE, {
        matchText: LIFECYCLE_FLOW_MATCH_TEXT,
        ignoreText: LIFECYCLE_FLOW_IGNORE_TEXT,
      }),
    ]);
    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterSync();
    await waitForDistinctGunPeersExcludingSelf(pageTom, 2, 120_000);
    await clickBroadcastUntilBulkAck(pageTom);

    await completeTalkInAppByAnswerIds(
      pageJerry,
      created.talkId,
      created.talkData,
      flowMatchAnswerIds(),
      'match',
    );
    await completeTalkInAppByAnswerIds(
      pageBob,
      created.talkId,
      created.talkData,
      flowIgnoreAnswerIds(),
      'mismatch',
    );

    await waitForStatusBarMatchCountAtLeast(pageTom, 1, 120_000);
    await waitForServerConversations(pageTom, 1);
    await waitForServerConversations(pageJerry, 1);
    await expectActiveTransportMode(pageTom, 'direct-p2p');
    await expectActiveTransportMode(pageJerry, 'direct-p2p');
    const jerryMatrixId = await pageJerry.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id);
    await expectConversationTransportModeForPeerId(pageTom, jerryMatrixId, 'direct-p2p');

    await expect
      .poll(
        async () =>
          pageTom.evaluate(() => {
            const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
            const names = Object.values(conversations)
              .filter((c: any) => c?.supportChannel !== true)
              .map((c: any) => c?.otherUserName);
            return { count: names.length, hasJerry: names.includes('Jerry Matrix'), hasBob: names.includes('Bob Matrix') };
          }),
        { timeout: 30_000 },
      )
      .toEqual({ count: 1, hasJerry: true, hasBob: false });

    await pageTom.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageTom, 'contacts');
    await afterSync();
    const jerryContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Jerry Matrix' });
    const bobContact = pageTom.locator('#contacts-list .contact-item').filter({ hasText: 'Bob Matrix' });
    await expect(jerryContact).toBeVisible({ timeout: 60_000 });
    await expect(jerryContact).toContainText(/Stranger/i);
    await expect(bobContact).toBeVisible({ timeout: 60_000 });

    await pageJerry.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageJerry, 'me');
    await afterSync();
    const jerryAnswers = pageJerry.locator('#answers-content');
    await expect(jerryAnswers.getByText(FLOW_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await expect(jerryAnswers.getByText(/Match/i).first()).toBeVisible({ timeout: 15_000 });

    await pageBob.click('.nav-btn[data-view="me"]');
    await waitForTabActive(pageBob, 'me');
    await afterSync();
    const bobAnswers = pageBob.locator('#answers-content');
    await expect(bobAnswers.getByText(FLOW_TITLE).first()).toBeVisible({ timeout: 30_000 });
    await expect(bobAnswers.getByText(/Mismatch/i).first()).toBeVisible({ timeout: 15_000 });

    await afterAction();
  });
});
