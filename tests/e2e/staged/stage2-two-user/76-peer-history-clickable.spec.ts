/**
 * TODO §O: every exchanged talk in the peer-detail history list is clickable — not only the
 * ones already surfaced in #peer-conversations-section (which requires a message to have been
 * sent under that talkId first). Clicking opens the DM with that talk as the active thread
 * context, creating the conversation on demand if the pair has never messaged at all.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless, afterNav, afterAction } from '../../helpers/timing';
import { setupFastMatchedDm, teardownFastDmPair, FastDmPair } from '../../helpers/fast-dm-setup';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Peer-detail exchanged-talk history is clickable (O)', () => {
  let browserA: Browser;
  let browserB: Browser;
  let pair: FastDmPair | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserA = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=1000,1100'] });
    browserB = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1000,0', '--window-size=800,1100'] });
  });

  test.beforeEach(async () => {
    await clearGunForStage2Spec();
  });

  test.afterEach(async () => {
    if (pair) await teardownFastDmPair(pair);
    pair = undefined;
  });

  test.afterAll(async () => {
    await browserA?.close().catch(() => {});
    await browserB?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('a mismatch talk with no conversation yet: clicking creates one, scoped to that talk', async () => {
    const tom = await bootstrapUser(browserA, 'PeerHistTomNew', 'PeerHistTomNew');
    const jerry = await bootstrapUser(browserB, 'PeerHistJerryNew', 'PeerHistJerryNew');
    const pageTom = tom.page;
    const pageJerry = jerry.page;
    try {
      const jerryId = await pageJerry.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));

      // Seed a mismatch exchange directly (no conversation record exists for this pair at all).
      await pageTom.evaluate(
        ({ peerId, peerName }) => {
          const exchange = {
            peerId,
            peerName,
            talkId: 'qa_mismatch1',
            title: 'Never Messaged Talk',
            outcome: 'mismatch',
            direction: 'sent',
            date: new Date().toISOString(),
            type: 'flow',
          };
          localStorage.setItem('localTalkExchanges', JSON.stringify([exchange]));
          // showConversationDetail's thread-scope title reads from myTalks, not localTalkExchanges.
          localStorage.setItem('myTalks', JSON.stringify({
            qa_mismatch1: { role: 'created', title: 'Never Messaged Talk', type: 'flow' },
          }));
        },
        { peerId: jerryId, peerName: 'PeerHistJerryNew' },
      );

      await pageTom.evaluate(
        ({ id, name }) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser?.(id, name),
        { id: jerryId, name: 'PeerHistJerryNew' },
      );
      await afterNav();
      await expect(pageTom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });

      const historyRow = pageTom.locator('.peer-history-item[data-talk-id="qa_mismatch1"]');
      await expect(historyRow).toBeVisible({ timeout: 10_000 });

      // No conversation should exist yet.
      const conversationExistsBefore = await pageTom.evaluate((peerId: string) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return Object.values(conversations).some((c: any) => c?.otherUserId === peerId);
      }, jerryId);
      expect(conversationExistsBefore).toBe(false);

      await historyRow.click();
      await afterAction();

      await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
      await expect(pageTom.locator('#conversation-thread-scope')).toContainText('Never Messaged Talk', { timeout: 10_000 });
      await expect(pageTom.locator('#conversation-thread-scope')).toHaveAttribute('data-talk-id', 'qa_mismatch1');

      const conversationExistsAfter = await pageTom.evaluate((peerId: string) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return Object.values(conversations).some((c: any) => c?.otherUserId === peerId);
      }, jerryId);
      expect(conversationExistsAfter).toBe(true);
    } finally {
      await pageTom.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await pageJerry.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await tom.context.close().catch(() => {});
      await jerry.context.close().catch(() => {});
    }
  });

  test('existing conversation: matched talk opens its known thread; a second exchanged talk re-scopes without a regression', async () => {
    pair = await setupFastMatchedDm(browserA, browserB, 'PeerHistTom', 'PeerHistJerry');
    const { pageA, userIdB } = pair;

    // The fast-DM helper's matched talk id, plus a seeded mismatch exchange for a second talk
    // with the same peer — same conversation, two distinct thread contexts.
    const matchedTalkId = await pageA.evaluate((peerId: string) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      const entry = Object.values(conversations).find((c: any) => c?.otherUserId === peerId) as any;
      return String(entry?.talkId || '');
    }, userIdB);
    expect(matchedTalkId).toBeTruthy();

    await pageA.evaluate(
      ({ peerId, peerName }) => {
        const exchange = {
          peerId,
          peerName,
          talkId: 'qa_mismatch2',
          title: 'Second Exchanged Talk',
          outcome: 'mismatch',
          direction: 'sent',
          date: new Date().toISOString(),
          type: 'flow',
        };
        localStorage.setItem('localTalkExchanges', JSON.stringify([exchange]));
        // showConversationDetail's thread-scope title reads from myTalks, not localTalkExchanges.
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks.qa_mismatch2 = { role: 'created', title: 'Second Exchanged Talk', type: 'flow' };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
      },
      { peerId: userIdB, peerName: 'PeerHistJerry' },
    );

    await pageA.locator('#back-from-conversation').click();
    await afterNav();
    await pageA.evaluate(
      ({ id, name }) => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.openPeerDetailForUser?.(id, name),
      { id: userIdB, name: 'PeerHistJerry' },
    );
    await afterNav();
    await expect(pageA.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });

    // Click the ALREADY-matched talk's history row — no regression: opens the same thread
    // #peer-conversations-section already would.
    const matchedRow = pageA.locator(`.peer-history-item[data-talk-id="${matchedTalkId}"]`);
    await expect(matchedRow).toBeVisible({ timeout: 10_000 });
    // Click the meta line (outcome/date), not the row's geometric center: the matched talk's
    // auto-generated title (setupFastMatchedDm's "Fast DM Setup Talk fast-dm-<id>") is long
    // enough to wrap onto two lines, which can push a center-click onto the sent-talk title —
    // a nested <button class="peer-history-title-link"> that calls stopPropagation() and opens
    // "View Responses" instead of the row's own "open this thread" handler. .peer-history-meta
    // is never covered by that button, so it reliably reaches the row's own click listener.
    await matchedRow.locator('.peer-history-meta').click();
    await afterAction();
    await expect(pageA.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.locator('#conversation-thread-scope')).toHaveAttribute('data-talk-id', matchedTalkId);
    const conversationIdFirst = await pageA.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
    );

    // Back to the User layout, click the SECOND exchanged talk's history row — same
    // conversation, re-scoped to the new talk (distinct thread context, no collapsing).
    await pageA.click('#back-from-conversation');
    await afterNav();
    await expect(pageA.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
    const secondRow = pageA.locator('.peer-history-item[data-talk-id="qa_mismatch2"]');
    await expect(secondRow).toBeVisible({ timeout: 10_000 });
    await secondRow.click();
    await afterAction();
    await expect(pageA.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(pageA.locator('#conversation-thread-scope')).toHaveAttribute('data-talk-id', 'qa_mismatch2');
    await expect(pageA.locator('#conversation-thread-scope')).toContainText('Second Exchanged Talk');

    const conversationIdSecond = await pageA.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
    );
    // Same conversation both times (one-per-pair) — just a different active thread scope.
    expect(conversationIdSecond).toBe(conversationIdFirst);
  });
});
