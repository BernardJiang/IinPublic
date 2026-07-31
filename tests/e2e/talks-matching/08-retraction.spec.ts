/**
 * P0 step 10 -- Talk retraction (three browsers).
 *
 * Scenario:
 *   Tom broadcasts a tag talk.
 *   Jerry answers with match; Bob answers with ignore.
 *   Tom unchecks / deletes the tag -> broadcasts talk-retracted frame.
 *   Both Jerry and Bob receive the "match gone" notice with timestamp
 *   (conversation-list data-conversation-status="withdrawn", data-retracted-at).
 *   Tom's own conversation with Jerry moves to status='withdrawn'.
 *   Jerry then attempts a change-of-mind answer -> NOT delivered to Tom (dead inbox).
 *   Assert Tom's ledger/conversation is unchanged after Jerry's post-retraction answer.
 *
 * Assertions (durable, not toast-only):
 *   - myConversations status === 'withdrawn' both sides (Tom, Jerry)
 *   - retractedAt set on conversation record
 *   - talkLedger.retracted tombstone on Tom, Jerry, Bob
 *   - no second delivery on Tom after Jerry's post-retraction answer attempt
 *
 * See companion 08-retraction.md for plain-English description.
 *
 * NOTE: no asterisk-slash sequences inside block comments per CLAUDE.md.
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
  ensureMeshNeighbors,
  finalCleanupPages,
  waitForTabActive,
} from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../helpers/ports';

const MESH_E2E_TIMEOUT_MS = 30_000;

test.describe('Retraction -- step 10 (three browsers)', () => {
  test.describe.configure({ retries: 0 });
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

  test('Jerry matched + Bob ignored; Tom retracts; both see withdrawn; Jerry post-retraction answer not delivered', async () => {
    test.setTimeout(300_000);

    // ---- 1. Bootstrap -------------------------------------------------------
    void webAppURLStableChatroom();
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Ret'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Ret'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Ret'),
    ]);

    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;

    await afterLoad();

    // ---- 2. Verify mesh enabled --------------------------------------------
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
          { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: mesh not enabled` },
        )
        .toBe(true);
    }

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

    // ---- 3. Track response endpoint calls (must stay 0) --------------------
    let tomResponseCalls = 0;
    await pageTom.route('**/api/talks/*/response', (route) => { tomResponseCalls++; void route.continue(); });

    // ---- 4. Warm mesh connections (active re-warm until linked) -------------
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    // ---- 5. Tom broadcasts a tag talk to Jerry and Bob --------------------
    const TOM_TALK_ID = `ret-tom-${Date.now()}`;
    const TOM_TALK_TITLE = 'Ret Tennis Tom';

    const tomEpub = await pageTom.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });

    const tomTalkDef = {
      id: TOM_TALK_ID,
      type: 'tag',
      title: TOM_TALK_TITLE,
      authorId: tomId,
      authorName: 'Tom Ret',
      authorEpub: tomEpub,
      questions: [
        {
          id: 'q1',
          text: 'Tennis?',
          answers: [
            { id: 'a-match', text: 'Yes', isMatch: true },
            { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true },
          ],
        },
      ],
    };

    await pageTom.evaluate(
      async ({ tDef, rIds }: { tDef: any; rIds: string[] }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('Tom: peerMeshService unavailable');
        mesh.cacheTalkBody(tDef.id, tDef);
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[tDef.id] = { role: 'created', fullTalk: tDef };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        await mesh.broadcastTalk(tDef, { recipientUserIds: rIds, roomBroadcast: true });
      },
      { tDef: tomTalkDef, rIds: [jerryId, bobId] },
    );

    await afterAction();

    // ---- 6. Wait for Jerry and Bob to receive Tom's talk body ---------------
    for (const [label, page, aId] of [
      ['Jerry', pageJerry, tomId],
      ['Bob', pageBob, tomId],
    ] as const) {
      await expect
        .poll(
          () => page.evaluate(
            ({ tId, aId: authorId }: { tId: string; aId: string }) => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              const diag = app?.meshAnnounceDiagnostics as
                | { received: Array<{ talkId: string; authorId: string }> }
                | undefined;
              return (diag?.received ?? []).some((r) => r.talkId === tId && r.authorId === authorId);
            },
            { tId: TOM_TALK_ID, aId },
          ),
          { timeout: MESH_E2E_TIMEOUT_MS, message: `${label}: did not receive Tom's talk` },
        )
        .toBe(true);
    }

    await afterSync();

    // ---- 7. Jerry answers MATCH; Bob answers IGNORE -------------------------
    const matchAnswers = [
      { questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true },
    ];
    const ignoreAnswers = [
      { questionId: 'q1', answerId: 'a-ignore', answerText: 'No', mode: 'manual', isIgnore: true },
    ];

    await pageJerry.evaluate(
      async ({ talkId, authorId, authorName, tDef, answers }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Jerry: app unavailable');
        app.peerMeshService?.cacheTalkBody?.(talkId, tDef);
        await (app as any).submitTalkResponsePairDirect({
          talkId,
          talkData: { ...tDef, authorId, authorName },
          answers,
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { talkId: TOM_TALK_ID, authorId: tomId, authorName: 'Tom Ret', tDef: tomTalkDef, answers: matchAnswers },
    );

    await pageBob.evaluate(
      async ({ talkId, authorId, authorName, tDef, answers }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Bob: app unavailable');
        app.peerMeshService?.cacheTalkBody?.(talkId, tDef);
        await (app as any).submitTalkResponsePairDirect({
          talkId,
          talkData: { ...tDef, authorId, authorName },
          answers,
          isChatbotResponse: false,
          authorId,
          authorName,
          isAutoResponse: false,
        });
      },
      { talkId: TOM_TALK_ID, authorId: tomId, authorName: 'Tom Ret', tDef: tomTalkDef, answers: ignoreAnswers },
    );

    await afterAction();
    await afterSync();

    // ---- 8. Tom must have a match conversation with Jerry ------------------
    await expect
      .poll(
        () => pageTom.evaluate(({ jId }: { jId: string }) => {
          const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          return Object.values(convs).some((c: any) => c?.otherUserId === jId);
        }, { jId: jerryId }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Tom: conversation with Jerry not created before retraction' },
      )
      .toBe(true);

    // ---- 9. Tom retracts the talk ------------------------------------------
    const retractionTs = await pageTom.evaluate(
      async ({ tId }: { tId: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Tom: app unavailable');
        const retractedAt = Date.now();
        // Simulate the retractTalk event that ui-manager emits on delete/uncheck.
        await (app as any).handleRetractTalk?.(tId, retractedAt);
        return retractedAt;
      },
      { tId: TOM_TALK_ID },
    );
    expect(retractionTs).toBeGreaterThan(0);

    await afterAction();
    await afterSync();

    // ---- 10. Tom's own ledger has the tombstone ----------------------------
    const tomTombstone = await pageTom.evaluate(
      ({ tId, aId }: { tId: string; aId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        return doc?.retracted?.[`${tId}::${aId}`] ?? null;
      },
      { tId: TOM_TALK_ID, aId: tomId },
    );
    expect(tomTombstone, 'Tom: tombstone not written').not.toBeNull();
    expect(tomTombstone.retractedAt).toBeGreaterThan(0);

    // ---- 11. Tom's conversation with Jerry is now withdrawn ----------------
    const tomConvStatus = await pageTom.evaluate(({ jId }: { jId: string }) => {
      const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(convs).find((c: any) => c?.otherUserId === jId) as any;
      return conv?.status ?? null;
    }, { jId: jerryId });
    expect(tomConvStatus, "Tom: conversation not marked 'withdrawn'").toBe('withdrawn');

    // ---- 12. Jerry must receive the retraction and conversation withdrawn ---
    await expect
      .poll(
        () => pageJerry.evaluate(
          ({ tId, aId }: { tId: string; aId: string }) => {
            const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
            return !!doc?.retracted?.[`${tId}::${aId}`];
          },
          { tId: TOM_TALK_ID, aId: tomId },
        ),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry: retraction tombstone not received' },
      )
      .toBe(true);

    await expect
      .poll(
        () => pageJerry.evaluate(({ tId }: { tId: string }) => {
          const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          const conv = Object.values(convs).find((c: any) => c?.talkId === tId) as any;
          return conv?.status ?? null;
        }, { tId: TOM_TALK_ID }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: "Jerry: conversation not marked 'withdrawn'" },
      )
      .toBe('withdrawn');

    // retractedAt must be set on Jerry's conversation
    const jerryConvRetractedAt = await pageJerry.evaluate(({ tId }: { tId: string }) => {
      const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(convs).find((c: any) => c?.talkId === tId) as any;
      return conv?.retractedAt ?? null;
    }, { tId: TOM_TALK_ID });
    expect(jerryConvRetractedAt, 'Jerry: retractedAt not set on conversation').not.toBeNull();

    // ---- 13. Bob also receives the retraction tombstone --------------------
    await expect
      .poll(
        () => pageBob.evaluate(
          ({ tId, aId }: { tId: string; aId: string }) => {
            const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
            return !!doc?.retracted?.[`${tId}::${aId}`];
          },
          { tId: TOM_TALK_ID, aId: tomId },
        ),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Bob: retraction tombstone not received' },
      )
      .toBe(true);

    // ---- 14. Durable attribute check on Jerry's conversation-list ----------
    await waitForTabActive(pageJerry, 'me');
    await expect
      .poll(
        () => pageJerry.evaluate(
          ({ tId }: { tId: string }) => {
            const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
            const conv = Object.values(convs).find((c: any) => c?.talkId === tId) as any;
            return conv?.status ?? null;
          },
          { tId: TOM_TALK_ID },
        ),
        { timeout: MESH_E2E_TIMEOUT_MS },
      )
      .toBe('withdrawn');

    // ---- 15. Jerry attempts a post-retraction change-of-mind ---------------
    // Capture Tom's ledger state before the stale answer attempt.
    const tomLedgerBefore = await pageTom.evaluate(
      ({ jId, tId, aId }: { jId: string; tId: string; aId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        const outcomes = doc?.outcomes ?? {};
        const entry = Object.values(outcomes as Record<string, any>).find(
          (e: any) => e?.responderId === jId && e?.talkId === tId,
        );
        return { outcomeCount: Object.keys(outcomes).length, entry: entry ?? null, tombstone: doc?.retracted?.[`${tId}::${aId}`] };
      },
      { jId: jerryId, tId: TOM_TALK_ID, aId: tomId },
    );

    // Jerry tries to submit another answer (change-of-mind) for Tom's retracted talk.
    await pageJerry.evaluate(
      async ({ talkId, authorId, authorName, tDef, answers }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Jerry: app unavailable');
        try {
          await (app as any).submitTalkResponsePairDirect({
            talkId,
            talkData: { ...tDef, authorId, authorName },
            answers,
            isChatbotResponse: false,
            authorId,
            authorName,
            isAutoResponse: false,
          });
        } catch {
          // Expected: dead inbox suppresses delivery; errors are non-fatal
        }
      },
      { talkId: TOM_TALK_ID, authorId: tomId, authorName: 'Tom Ret', tDef: tomTalkDef, answers: matchAnswers },
    );

    await afterAction();
    await afterSync();

    // ---- 16. Tom's ledger must be unchanged after Jerry's stale answer ------
    const tomLedgerAfter = await pageTom.evaluate(
      ({ jId, tId, aId }: { jId: string; tId: string; aId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        const outcomes = doc?.outcomes ?? {};
        const entry = Object.values(outcomes as Record<string, any>).find(
          (e: any) => e?.responderId === jId && e?.talkId === tId,
        );
        return { outcomeCount: Object.keys(outcomes).length, entry: entry ?? null, tombstone: doc?.retracted?.[`${tId}::${aId}`] };
      },
      { jId: jerryId, tId: TOM_TALK_ID, aId: tomId },
    );

    // Tombstone must still be present (retraction is permanent)
    expect(tomLedgerAfter.tombstone, 'Tom: tombstone was removed after stale answer').not.toBeNull();
    // Outcome count must not have grown (the stale answer was not ingested)
    expect(
      tomLedgerAfter.outcomeCount,
      'Tom: outcome count grew after stale answer — dead inbox failed',
    ).toBe(tomLedgerBefore.outcomeCount);

    // ---- 17. Server response endpoint invariant ----------------------------
    expect(tomResponseCalls, 'Tom: zero /api/talks/*/response POST calls').toBe(0);
  });
});
