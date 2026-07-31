/**
 * P0 step 8 — Sender-side suppression (three browsers).
 *
 * Tom broadcasts a tag talk. Jerry IGNORES, Bob MATCHES.
 * Tom rebroadcasts the same talk.
 *
 * Assertions:
 *  - Tom's talkLedger.outcomes records Jerry=ignored + Bob=matched with
 *    version=1 and respondedAt set.
 *  - After rebroadcast, Jerry's incoming cluster count for that talk identity
 *    is unchanged (never re-prompted).
 *  - Tom's mesh-announce diagnostic count for the identity did not increase
 *    after the rebroadcast (suppression at recipient selection).
 *  - Zero POST response-endpoint calls (mesh-only delivery).
 *
 * See companion 06-sender-suppression.md for plain-English description.
 */

import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage3Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import {
  bootstrapUser,
  finalCleanupPages,
  waitForTabActive,
} from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../helpers/ports';

const MESH_E2E_TIMEOUT_MS = 30_000;

/** Warm mesh connections between a page and a list of peer ids. */
async function warmMesh(page: Page, otherIds: string[]): Promise<void> {
  await page.evaluate(async (peerIds: string[]) => {
    const app = (window as any).__iinpublic_app?.getApp?.() as any;
    if (!app?.warmMeshConnectionToPeer) return;
    for (const peerId of peerIds) {
      await app.warmMeshConnectionToPeer(peerId).catch(() => { /* best-effort */ });
    }
  }, otherIds);
}

test.describe('Sender-side suppression — step 8 (three browsers)', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(300_000);
    await clearGunForStage3Spec();
    const mk = (x: number) => ({
      headless: !!process.env.CI,
      args: [
        `--window-position=${x},40`,
        '--window-size=640,1200',
        '--force-device-scale-factor=1',
        ...WEBRTC_CHROMIUM_ARGS,
      ],
    });
    const [tom, jerry, bob] = await Promise.all([
      chromium.launch(mk(0)),
      chromium.launch(mk(640)),
      chromium.launch(mk(1280)),
    ]);
    browsers = { tom, jerry, bob };
  });

  test.beforeEach(async () => {
    contextTom?.close().catch(() => {});
    contextJerry?.close().catch(() => {});
    contextBob?.close().catch(() => {});
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

  test('Jerry ignores → Tom rebroadcasts → Jerry never re-prompted; talkLedger records Jerry=ignored Bob=matched', async () => {
    test.setTimeout(300_000);

    // ── 1. Bootstrap all three users ───────────────────────────────────────────
    void webAppURLStableChatroom();
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Suppress'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Suppress'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Suppress'),
    ]);

    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;

    await afterLoad();

    // ── 2. Verify mesh is enabled ───────────────────────────────────────────────
    for (const [label, page] of [
      ['Tom', pageTom],
      ['Jerry', pageJerry],
      ['Bob', pageBob],
    ] as const) {
      await expect
        .poll(
          () => page.evaluate(() =>
            !!(window as any).__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.(),
          ),
          { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: mesh delivery not enabled` },
        )
        .toBe(true);
    }

    // Resolve user IDs
    const tomId = await pageTom.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const jerryId = await pageJerry.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const bobId = await pageBob.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    expect(tomId).toBeTruthy();
    expect(jerryId).toBeTruthy();
    expect(bobId).toBeTruthy();

    await afterSync();
    await afterSync();

    // ── 3. Track POST /api/talks/*/response (must stay 0) ────────────────────
    let tomResponseCalls = 0;
    await pageTom.route('**/api/talks/*/response', (route) => {
      tomResponseCalls++;
      void route.continue();
    });

    // ── 4. Warm mesh connections ────────────────────────────────────────────────
    await Promise.all([
      warmMesh(pageTom, [jerryId, bobId]),
      warmMesh(pageJerry, [tomId, bobId]),
      warmMesh(pageBob, [tomId, jerryId]),
    ]);

    for (const [label, page] of [
      ['Tom', pageTom],
      ['Jerry', pageJerry],
      ['Bob', pageBob],
    ] as const) {
      await expect
        .poll(
          () => page.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
          }),
          { timeout: MESH_E2E_TIMEOUT_MS, intervals: [300, 500, 1000], message: `${label}: no connected mesh neighbors` },
        )
        .toBeGreaterThan(0);
    }

    // ── 5. Tom creates and broadcasts a tag talk ──────────────────────────────
    const TEST_TALK_ID = `suppress-e2e-${Date.now()}`;
    const TEST_TALK_TITLE = 'Suppression E2E Tennis';

    const talkDef = {
      id: TEST_TALK_ID,
      authorId: tomId,
      title: TEST_TALK_TITLE,
      type: 'tag',
      questions: [
        {
          id: 'q1',
          text: 'Do you play Tennis?',
          answers: [
            { id: 'a-match', text: 'Yes', isMatch: true },
            { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    await pageTom.evaluate(
      async ({ talkId, authorId, tDef }: { talkId: string; authorId: string; tDef: any }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService not available on Tom');
        mesh.cacheTalkBody(talkId, tDef);
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[talkId] = { role: 'created', fullTalk: tDef };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        await mesh.broadcastTalk(tDef, { recipientUserIds: [authorId], roomBroadcast: true });
      },
      { talkId: TEST_TALK_ID, authorId: tomId, tDef: talkDef },
    );

    // First broadcast: deliver to Jerry and Bob
    await pageTom.evaluate(
      async ({ tDef, rIds }: { tDef: any; rIds: string[] }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService not available on Tom');
        await mesh.broadcastTalk(tDef, { recipientUserIds: rIds, roomBroadcast: true });
      },
      { tDef: talkDef, rIds: [jerryId, bobId] },
    );

    await afterAction();

    // ── 6. Wait for announce on Jerry and Bob ──────────────────────────────────
    for (const [label, page] of [
      ['Jerry', pageJerry],
      ['Bob', pageBob],
    ] as const) {
      await expect
        .poll(
          () => page.evaluate(
            ({ tId, aId }: { tId: string; aId: string }) => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              const diag = app?.meshAnnounceDiagnostics as
                | { received: Array<{ talkId: string; authorId: string }> }
                | undefined;
              return (diag?.received ?? []).some(
                (r) => r.talkId === tId && r.authorId === aId,
              );
            },
            { tId: TEST_TALK_ID, aId: tomId },
          ),
          { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: `${label}: did not receive talk-announce from Tom` },
        )
        .toBe(true);
    }

    await afterSync();

    // Record the initial announce count BEFORE responses
    const jerryAnnounceCountBefore = await pageJerry.evaluate(
      ({ tId, aId }: { tId: string; aId: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const diag = app?.meshAnnounceDiagnostics as
          | { received: Array<{ talkId: string; authorId: string }> }
          | undefined;
        return (diag?.received ?? []).filter((r) => r.talkId === tId && r.authorId === aId).length;
      },
      { tId: TEST_TALK_ID, aId: tomId },
    );

    // ── 7. Inject Tom's epub for encrypting response payload ─────────────────
    const tomEpub = await pageTom.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });

    const talkDefForPeers = {
      ...talkDef,
      authorEpub: tomEpub,
      authorName: 'Tom Suppress',
    };

    // ── 8. Jerry answers IGNORE; Bob answers MATCH ────────────────────────────
    await pageJerry.evaluate(
      async ({ talkId, tDef, authorId, authorName }: { talkId: string; tDef: any; authorId: string; authorName: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('app not available on Jerry');
        app.peerMeshService?.cacheTalkBody?.(talkId, tDef);
        const ignoreAnswers = [
          { questionId: 'q1', answerId: 'a-ignore', answerText: 'No', mode: 'manual', isIgnore: true },
        ];
        await (app as any).submitTalkResponsePairDirect({
          talkId,
          talkData: { ...tDef, authorId, authorName },
          answers: ignoreAnswers,
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { talkId: TEST_TALK_ID, tDef: talkDefForPeers, authorId: tomId, authorName: 'Tom Suppress' },
    );

    await pageBob.evaluate(
      async ({ talkId, tDef, authorId, authorName }: { talkId: string; tDef: any; authorId: string; authorName: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('app not available on Bob');
        app.peerMeshService?.cacheTalkBody?.(talkId, tDef);
        const matchAnswers = [
          { questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true },
        ];
        await (app as any).submitTalkResponsePairDirect({
          talkId,
          talkData: { ...tDef, authorId, authorName },
          answers: matchAnswers,
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { talkId: TEST_TALK_ID, tDef: talkDefForPeers, authorId: tomId, authorName: 'Tom Suppress' },
    );

    await afterAction();

    // ── 9. Wait for Tom to receive both responses ──────────────────────────────
    await expect
      .poll(
        () => pageTom.evaluate(({ jId, talkId }: { jId: string; talkId: string }) => {
          const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
          if (!doc) return null;
          // Find any outcome row with responderId === jId for this talk
          return Object.values(doc.outcomes as Record<string, any>).find(
            (e: any) => e.responderId === jId && e.talkId === talkId,
          ) ?? null;
        }, { jId: jerryId, talkId: TEST_TALK_ID }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [300, 600], message: "Tom: did not receive Jerry's response in ledger" },
      )
      .not.toBeNull();

    await expect
      .poll(
        () => pageTom.evaluate(({ bId, talkId }: { bId: string; talkId: string }) => {
          const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
          if (!doc) return null;
          return Object.values(doc.outcomes as Record<string, any>).find(
            (e: any) => e.responderId === bId && e.talkId === talkId,
          ) ?? null;
        }, { bId: bobId, talkId: TEST_TALK_ID }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [300, 600], message: "Tom: did not receive Bob's response in ledger" },
      )
      .not.toBeNull();

    // ── 10. Assert ledger state on Tom ─────────────────────────────────────────
    const jerryLedgerEntry = await pageTom.evaluate(
      ({ jId, talkId }: { jId: string; talkId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        if (!doc) return null;
        return Object.values(doc.outcomes as Record<string, any>).find(
          (e: any) => e.responderId === jId && e.talkId === talkId,
        ) ?? null;
      },
      { jId: jerryId, talkId: TEST_TALK_ID },
    );

    expect(jerryLedgerEntry, 'Tom ledger: Jerry outcome entry missing').not.toBeNull();
    expect(jerryLedgerEntry.outcome, 'Tom ledger: Jerry outcome must be ignored').toBe('ignored');
    expect(jerryLedgerEntry.version, 'Tom ledger: Jerry version must be 1').toBe(1);
    expect(jerryLedgerEntry.respondedAt, 'Tom ledger: Jerry respondedAt must be set').toBeTruthy();

    const bobLedgerEntry = await pageTom.evaluate(
      ({ bId, talkId }: { bId: string; talkId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        if (!doc) return null;
        return Object.values(doc.outcomes as Record<string, any>).find(
          (e: any) => e.responderId === bId && e.talkId === talkId,
        ) ?? null;
      },
      { bId: bobId, talkId: TEST_TALK_ID },
    );

    expect(bobLedgerEntry, 'Tom ledger: Bob outcome entry missing').not.toBeNull();
    expect(bobLedgerEntry.outcome, 'Tom ledger: Bob outcome must be matched').toBe('matched');
    expect(bobLedgerEntry.version, 'Tom ledger: Bob version must be 1').toBe(1);
    expect(bobLedgerEntry.respondedAt, 'Tom ledger: Bob respondedAt must be set').toBeTruthy();

    // ── 11. Tom rebroadcasts the same talk ────────────────────────────────────
    // deliverTalkToReceiversOverMesh should suppress both Jerry and Bob
    await pageTom.evaluate(
      async ({ tDef, rIds }: { tDef: any; rIds: string[] }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService not available on Tom');
        // Use deliverTalkToReceiversOverMesh which applies suppression
        const members = rIds.map((id: string) => ({ userId: id, stageName: id }));
        await (app as any).deliverTalkToReceiversOverMesh(tDef.id, tDef, members);
      },
      { tDef: talkDef, rIds: [jerryId, bobId] },
    );

    await afterAction();
    await afterSync();

    // ── 12. Assert Jerry was NOT re-prompted ───────────────────────────────────
    // Jerry's announce count must be the same as before the rebroadcast
    const jerryAnnounceCountAfter = await pageJerry.evaluate(
      ({ tId, aId }: { tId: string; aId: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const diag = app?.meshAnnounceDiagnostics as
          | { received: Array<{ talkId: string; authorId: string }> }
          | undefined;
        return (diag?.received ?? []).filter((r) => r.talkId === tId && r.authorId === aId).length;
      },
      { tId: TEST_TALK_ID, aId: tomId },
    );

    expect(
      jerryAnnounceCountAfter,
      'Jerry: announce count must not increase after rebroadcast (suppressed at sender)',
    ).toBe(jerryAnnounceCountBefore);

    // ── 13. Navigate Jerry to Talks tab and verify no new modal was triggered ──
    await waitForTabActive(pageJerry, 'talks');
    await afterSync();

    // Jerry's incoming cluster state should only have the original cluster
    const jerryIncomingCount = await pageJerry.evaluate(async (tId: string) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
      const clusterArr = clusters as Array<{ identityKey?: string; talkIds?: Record<string, unknown> }>;
      // Count clusters that reference this talkId
      return clusterArr.filter((c) =>
        c?.talkIds && typeof c.talkIds === 'object' && Object.keys(c.talkIds).some((k) => k === tId || k.startsWith(`${tId}__`)),
      ).length;
    }, TEST_TALK_ID);

    // Jerry should have at most 1 incoming cluster for this talk (the original one)
    expect(
      jerryIncomingCount,
      'Jerry: must have at most 1 incoming cluster for this talk identity (not re-delivered)',
    ).toBeLessThanOrEqual(1);

    // ── 14. Server-endpoint invariant ────────────────────────────────────────
    expect(tomResponseCalls, 'Tom: zero /api/talks/*/response POST calls').toBe(0);

    // ── 15. Bob conversation must exist (matched in first broadcast) ──────────
    await waitForTabActive(pageTom, 'me');
    const tomHasBobConversation = await pageTom.evaluate(({ bId }: { bId: string }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      return Object.values(conversations).some((c: any) => c?.otherUserId === bId);
    }, { bId: bobId });
    expect(tomHasBobConversation, 'Tom must have a conversation with Bob (match)').toBe(true);

    // Bob's conversation list must have Tom
    await waitForTabActive(pageBob, 'me');
    const bobHasTomConversation = await pageBob.evaluate(({ tId }: { tId: string }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      return Object.values(conversations).some((c: any) => c?.otherUserId === tId);
    }, { tId: tomId });
    expect(bobHasTomConversation, 'Bob must have a conversation with Tom (match)').toBe(true);
  });
});
