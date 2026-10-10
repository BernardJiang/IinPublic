import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { gunBaseURL, webAppURLStableChatroom } from '../../helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../../helpers/talks-matching-flow';
import {
  clickBroadcastUntilBulkAck,
  waitForBroadcastableTalkIds,
  waitForDistinctGunPeersExcludingSelf,
} from '../../helpers/talk-demo-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { prepareDirectP2PConversation } from '../../helpers/p2p-transport-e2e';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';
import {
  LEDGER_CHECKPOINT_INTERVAL,
  LEDGER_RETENTION_WINDOW,
} from '../../../../src/web/services/web-ledger-service';
import {
  MESSAGE_CHECKPOINT_INTERVAL,
  MESSAGE_RETENTION_WINDOW,
} from '../../../../src/web/services/gun-message-store';

/**
 * TODO §S Item 7 (docs/design/section-s-merkle-checkpoint-pruning-design-note.md): proves
 * the merkle-checkpoint pruning design (Items 1-4) end to end in real browsers, not just
 * unit-level fakes. Covers the design note's own four numbered requirements:
 *   1. Drive enough real activity to cross the checkpoint interval + retention window for
 *      both the ledger and messages, so a real prune actually fires.
 *   2. Assert the older raw Gun nodes are gone AND the checkpoint node exists with a
 *      valid signature.
 *   3. A peer who didn't receive events while they accumulated, then delta-syncs, still
 *      ends up caught up — via the checkpoint substitution Item 3 added, not a silent
 *      drop of the pruned range.
 *   4. Message history still renders correctly (the retained tail) after a prune.
 *
 * Bulk activity is driven via direct service calls (`*ForE2e` hooks on IinPublicApp,
 * app.ts) rather than hundreds of real UI actions — the same "drive via direct calls,
 * verify via real UI + Gun reads" shape already established by
 * tests/e2e/mass/04-heavy-user-gui-stress.spec.ts, adapted here for ledger/message
 * services instead of localStorage/HTTP seeding.
 */
test.describe('Ledger + message checkpoint pruning end to end', () => {
  test.describe.configure({ retries: 0 });
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;

  const MATCH_ANSWER = 'Yes, lets play.';
  const IGNORE_ANSWER = 'No thanks.';

  // Sequential ledger appends (each a real SEA-signed Gun write, awaited) plus sequential
  // message sends push this past the usual stage2 spec's runtime, even at the small
  // env-overridden checkpoint/retention scale this spec runs at (see its own .md).
  test.setTimeout(600_000);

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { /* best effort */ }
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await pageTom?.close();
    await pageJerry?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await clearGunForStage2Spec();
  });

  async function bootstrapUser(browser: Browser, label: string, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  async function currentUserId(page: Page): Promise<string> {
    return page.evaluate(
      () => (window as unknown as { __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } } })
        .__iinpublic_app?.getApp?.()?.currentUser?.id || '',
    );
  }

  test('ledger and message pruning fire for real, and a lagging peer still catches up via delta-sync', async () => {
    test.skip(
      LEDGER_CHECKPOINT_INTERVAL !== 5 ||
        LEDGER_RETENTION_WINDOW !== 25 ||
        MESSAGE_CHECKPOINT_INTERVAL !== 5 ||
        MESSAGE_RETENTION_WINDOW !== 10,
      'Requires tuned E2E checkpoint env: IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL=5, IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25, IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL=5, IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW=10, IINPUBLIC_E2E_ENABLE_LEDGER=1',
    );

    const talkTitle = `Pruning E2E ${Date.now()}`;

    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    const tomUserId = await currentUserId(pageTom);
    await openCurrentChatroom(pageTom);

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await openCurrentChatroom(pageJerry);

    // ── Match Tom and Jerry so a real conversation + ledger MATCH_CREATED event exist ──
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', talkTitle);
    await selectTalkEditorType(pageTom, 'flow');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a pruning test partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-submit-btn');
    await afterSync();

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await openCurrentChatroom(pageTom);
    await afterNav();
    await waitForBroadcastableTalkIds(pageTom, 120_000);
    await waitForDistinctGunPeersExcludingSelf(pageTom, 1, 240_000);
    await clickBroadcastUntilBulkAck(pageTom);
    await afterSync();

    const jerryUserId = await currentUserId(pageJerry);

    await openIncomingTalkModal(pageJerry, talkTitle);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(pageJerry);
    await afterSync();

    const conversationId = await prepareDirectP2PConversation(pageTom, pageJerry, tomUserId, jerryUserId, 'Tom', 'Jerry');

    // ── Requirement 1 (ledger): drive Tom's ledger comfortably past checkpoint+retention.
    // Each appendEvent is a real, sequential, awaited Gun round trip (event + head +
    // index writes) — production-scale N=100/M=500 would mean 600+ of these, far too slow
    // for a real-browser E2E run. IINPUBLIC_E2E_LEDGER_CHECKPOINT_INTERVAL/
    // IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW (set when this spec is run — see its own .md)
    // shrink the constants this test imports so the same mechanism is proven at a scale
    // that finishes in a reasonable time; unset, these fall back to the real values.
    //
    // fillCount is deliberately calibrated (not just "interval + retention + margin") to
    // cross the retention boundary by the smallest amount that still guarantees a real
    // prune: each *pruned* seq costs up to ~12s (a real Gun quirk found while writing
    // this spec — deleting a flat string-keyed ledger event node by nulling its fields
    // rarely gets acked quickly, so the write falls through to the relaxed-mode 12s
    // timeout before "continuing optimistically"; ordinary event writes ack normally).
    // With LEDGER_CHECKPOINT_INTERVAL(N)/LEDGER_RETENTION_WINDOW(M) set to 5/25 for this
    // spec, the checkpoint carrying its own event forward into the next window means the
    // k-th checkpoint lands after `N + (k-1)*(N-1)` real appendEvent calls; k=5 is the
    // first checkpoint whose window (rangeEnd=5k=25) exceeds the retention window (25),
    // and prunes exactly one seq (seq 1) — `N + (k-1)*(N-1)` = `5 + 4*4` = 21. ──
    // The "+4" below assumes IINPUBLIC_E2E_LEDGER_RETENTION_WINDOW=25 specifically (k=5 is
    // the first checkpoint whose rangeEnd exceeds a retention window of 25) — guard so a
    // future change to that env var doesn't silently miscalibrate this spec.
    expect(LEDGER_RETENTION_WINDOW).toBe(25);
    const ledgerFillCount = LEDGER_CHECKPOINT_INTERVAL + 4 * (LEDGER_CHECKPOINT_INTERVAL - 1) + 1;
    await pageTom.evaluate(
      async (count) => (window as any).__iinpublic_app.getApp().appendLedgerEventsForE2e(count),
      ledgerFillCount,
    );

    const tomLedgerState = await pageTom.evaluate(
      () => (window as any).__iinpublic_app.getApp().getLedgerStateForE2e(),
    );
    const tomFinalSeq: number = tomLedgerState[tomUserId];
    expect(tomFinalSeq).toBeGreaterThanOrEqual(ledgerFillCount);

    // ── Requirement 2 (ledger): seq 1 (Tom's very first ledger event) is now pruned, and
    // the most recent fully-written checkpoint still verifies via the service's own
    // verifyEvent — not present-but-corrupt, and not silently skipped.
    //
    // Polled rather than a one-shot check: pruneLedgerEvents' own await already waits for
    // the delete's Gun ack (or the 12s relaxed-mode fallback) before returning, but a
    // fresh .get() read racing the local graph's own processing of that write can still
    // briefly observe stale data — poll a few seconds to distinguish that from a genuine
    // correctness gap. ──
    await expect
      .poll(
        async () =>
          pageTom.evaluate(() => (window as any).__iinpublic_app.getApp().isLedgerRawEventPresentForE2e(1)),
        { message: 'seq 1 should eventually be pruned from Gun', timeout: 30_000 },
      )
      .toBe(false);

    const lastCheckpointRangeEnd = Math.floor(tomFinalSeq / LEDGER_CHECKPOINT_INTERVAL) * LEDGER_CHECKPOINT_INTERVAL;
    const checkpoint = await pageTom.evaluate(
      (seq) => (window as any).__iinpublic_app.getApp().getLedgerCheckpointVerifiedForE2e(seq),
      lastCheckpointRangeEnd + 1,
    );
    expect(checkpoint).toBeTruthy();
    expect(checkpoint.verified).toBe(true);
    expect(checkpoint.count).toBe(LEDGER_CHECKPOINT_INTERVAL);
    expect(checkpoint.rangeEnd).toBe(lastCheckpointRangeEnd);

    // ── Requirement 3: Jerry never received Tom's bulk ledger fill (no proactive re-sync
    // happens between two already-connected peers absent a reconnect event) — Jerry is
    // the "lagging/offline" peer. Tom now requests Jerry's state over the direct channel
    // and returns the missing delta; Jerry must end up caught up to Tom's real head, proving the
    // pruned range was substituted with its covering checkpoint rather than silently
    // dropped (the regression Item 3 exists to prevent — before it, syncWithPeer's
    // `if (!event) continue;` skipped pruned seqs).
    //
    const jerryStateBefore = await pageJerry.evaluate(
      () => (window as any).__iinpublic_app.getApp().getLedgerStateForE2e(),
    );
    expect(jerryStateBefore[tomUserId] ?? 0).toBeLessThan(tomFinalSeq);

    await pageTom.evaluate(
      (peerId) => (window as any).__iinpublic_app.getApp().pushLedgerSyncToPeerForE2e(peerId),
      jerryUserId,
    );

    // The ordered DataChannel carries the request, state, and signed event batches. No
    // reload is needed, and reloading would tear down the matched conversation session.
    await expect
      .poll(
        async () => {
          const state = await pageJerry.evaluate(
            () => (window as any).__iinpublic_app.getApp().getLedgerStateForE2e(),
          );
          return state[tomUserId] ?? 0;
        },
        { message: 'Jerry should catch up to Tom\'s ledger head via delta-sync', timeout: 60_000 },
      )
      .toBe(tomFinalSeq);

    // ── Requirement 1 (messages): drive Tom+Jerry's conversation comfortably past its own
    // checkpoint+retention window. Same env-override rationale as the ledger fill above —
    // see IINPUBLIC_E2E_MESSAGE_CHECKPOINT_INTERVAL/IINPUBLIC_E2E_MESSAGE_RETENTION_WINDOW. ──
    const messageFillCount = MESSAGE_CHECKPOINT_INTERVAL + MESSAGE_RETENTION_WINDOW + 5;
    await pageTom.evaluate(
      async ({ cid, otherId, count }) =>
        (window as any).__iinpublic_app.getApp().sendConversationMessagesForE2e(cid, otherId, count, 'e2e-fill'),
      { cid: conversationId, otherId: jerryUserId, count: messageFillCount },
    );
    // All appends, checkpoints, and pruning complete before sendMessage resolves.

    // ── Requirement 2 (messages): the peerless encrypted local envelope contains a
    // bounded retained tail plus checkpoints, while the relay has no message bodies. ──
    const localEnvelope = await pageTom.evaluate(async (cid) => {
      const app = (window as any).__iinpublic_app.getApp();
      return app.gunService.getPrivate(`conversations/${encodeURIComponent(cid)}/history`);
    }, conversationId) as {
      messagesJson: string;
      checkpointsJson: string;
      totalCount: number;
      lastCheckpointedCount: number;
      prunedThroughCount: number;
    };
    const retainedMessages = JSON.parse(localEnvelope.messagesJson) as Array<{
      id: string;
      text: string;
      encryption?: string;
    }>;
    const messageCheckpoints = JSON.parse(localEnvelope.checkpointsJson) as unknown[];
    expect(messageCheckpoints.length).toBeGreaterThan(0);
    expect(localEnvelope.totalCount).toBeGreaterThanOrEqual(messageFillCount);
    expect(localEnvelope.lastCheckpointedCount).toBeGreaterThan(0);
    expect(localEnvelope.prunedThroughCount).toBeGreaterThan(0);
    expect(retainedMessages.length).toBeLessThanOrEqual(MESSAGE_RETENTION_WINDOW);
    expect(retainedMessages.some((message) => message.id === 'e2e-fill-0')).toBe(false);
    const lastMessage = retainedMessages.find(
      (message) => message.id === `e2e-fill-${messageFillCount - 1}`,
    );
    expect(lastMessage?.encryption).toBe('sea-ecdh-v1');
    expect(typeof lastMessage?.text).toBe('string');

    const snapshotRes = await pageTom.request.get(`${gunBaseURL()}/api/test/export-snapshot`);
    expect(snapshotRes.ok()).toBeTruthy();
    const snapshot = (await snapshotRes.json()) as { gunGraph?: Record<string, unknown> };
    const graph = snapshot.gunGraph ?? {};
    const publicMessageSouls = Object.keys(graph).filter(
      (key) =>
        (key.startsWith('pairConversations/') && key.includes(`/${conversationId}/messages/`)) ||
        key.startsWith(`conversations/${conversationId}/messages/`),
    );
    expect(publicMessageSouls).toHaveLength(0);
    expect(Object.keys(graph).filter((key) => key.startsWith('ledger/'))).toHaveLength(0);

    // ── Requirement 4: message history still renders correctly (the retained tail) in
    // the live UI after heavy pruning activity — the app doesn't break. ──
    await expect(
      pageTom.locator('#conversation-messages .message-text').last(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
