/**
 * Talks tab "Replies To My Talks" filter by query.
 * Bootstrap Alice, create a talk, inject mock reply data into localStorage,
 * then verify the reply-filter-query (#reply-filter-query) filters the replies
 * list: partial name match, case-insensitive, garbage empties, clear restores.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterNav, afterAction, headless, E2E_ASSERT_TIMEOUT_MS } from '../../helpers/timing';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { openCollapsedFilters } from '../../helpers/filter-bar';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Talks tab: replies filter by query', () => {
  let browserAlice: Browser;
  let contextAlice: BrowserContext;
  let pageAlice: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await pageAlice?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('reply filter: partial name match filters replies; case-insensitive; garbage empties; clear restores', async () => {
    // Bootstrap Alice
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;

    // Create mock reply data directly into localStorage
    // Use a fake talk ID and fake peer IDs
    const fakeTalkId = 'talk_' + Date.now();
    await pageAlice.evaluate((args: { fakeTalkId: string }) => {
      const exchanges: Record<string, any> = {};
      const bobbyKey = `bobby123::${args.fakeTalkId}`;
      const charlieKey = `charlie456::${args.fakeTalkId}`;

      exchanges[bobbyKey] = {
        peerId: 'bobby123',
        peerName: 'Bobby',
        talkId: args.fakeTalkId,
        title: 'Coffee Question',
        type: 'flow',
        language: 'en',
        outcome: 'match',
        direction: 'sent',
        date: new Date().toISOString(),
        answerMode: 'manual',
        answers: [{ questionId: 'q1', answerId: 'a1', answerText: 'Yes' }],
      };

      exchanges[charlieKey] = {
        peerId: 'charlie456',
        peerName: 'Charlie',
        talkId: args.fakeTalkId,
        title: 'Coffee Question',
        type: 'flow',
        language: 'en',
        outcome: 'mismatch',
        direction: 'sent',
        date: new Date().toISOString(),
        answerMode: 'manual',
        answers: [{ questionId: 'q1', answerId: 'a2', answerText: 'No' }],
      };

      localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
    }, { fakeTalkId });

    // Navigate to Talks tab
    await pageAlice.click('.nav-btn[data-view="talks"]');
    await afterNav();
    await afterLoad();

    // Wait for the reply section to appear (filters are collapsed at 640px — redesign §6)
    await openCollapsedFilters(pageAlice, 'replies-filter-toggle');
    const replyFilterInput = pageAlice.locator('#reply-filter-query');
    await replyFilterInput.waitFor({ state: 'visible', timeout: E2E_ASSERT_TIMEOUT_MS });

    const creatorReplyRows = pageAlice.locator('#creator-replies-list .creator-reply-row');
    const initialCount = await creatorReplyRows.count();
    expect(initialCount).toBeGreaterThanOrEqual(2, 'Should have at least 2 injected replies');

    // 1. Partial lowercase query matches Bobby's name
    await replyFilterInput.fill('bob');
    await afterAction();
    let visibleCount = await creatorReplyRows.count();
    expect(visibleCount).toBeGreaterThan(0, 'Should match "bob" in Bobby');
    expect(visibleCount).toBeLessThanOrEqual(initialCount);

    // 2. Case-insensitive: uppercase query still matches
    await replyFilterInput.fill('BOBBY');
    await afterAction();
    visibleCount = await creatorReplyRows.count();
    expect(visibleCount).toBeGreaterThan(0, 'Should match "BOBBY" case-insensitively');

    // 3. Partial match for Charlie
    await replyFilterInput.fill('char');
    await afterAction();
    visibleCount = await creatorReplyRows.count();
    expect(visibleCount).toBeGreaterThan(0, 'Should match "char" in Charlie');

    // 4. Garbage query matches nothing → empty result
    await replyFilterInput.fill('xyzabc123notfound');
    await afterAction();
    visibleCount = await creatorReplyRows.count();
    expect(visibleCount).toBe(0, 'Garbage query should return no results');

    // 5. Clearing the query restores the full list
    await replyFilterInput.fill('');
    await afterAction();
    visibleCount = await creatorReplyRows.count();
    expect(visibleCount).toBe(initialCount, 'Clearing filter should restore all replies');

    await pageAlice.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
