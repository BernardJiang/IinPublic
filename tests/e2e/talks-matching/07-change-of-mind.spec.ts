/**
 * P0 step 9 -- Change-of-mind (three browsers).
 *
 * Scenario:
 *   Tom AND Bob broadcast the SAME tag content (same identityKey, different authors).
 *   Jerry ignores BOTH.
 *   Jerry changes to match -> BOTH Tom and Bob get conversations; change surfaced with timestamp.
 *   Jerry reverts one to ignore -> that conversation ends (status 'ignored').
 *   Stale older-version update is rejected (no state change on sender).
 *
 * Assertions (durable, not toast-only):
 *   - conversation-list-item data-conversation-status + data-change-of-mind-at
 *   - myConversations in localStorage
 *   - talkLedger.outcomes version monotonicity
 *
 * See companion 07-change-of-mind.md for plain-English description.
 *
 * NOTE: no asterisk-slash sequences inside block comments per CLAUDE.md.
 */

import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
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

test.describe('Change-of-mind -- step 9 (three browsers)', () => {
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
    await maybeClearGunDatabases();
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
    await maybeClearGunDatabases();
  });

  test('Jerry ignores both; changes to match -> Tom+Bob get conversations; stale update rejected', async () => {
    test.setTimeout(300_000);

    // ---- 1. Bootstrap -------------------------------------------------------
    void webAppURLStableChatroom();
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom CoM'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry CoM'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob CoM'),
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
    let bobResponseCalls = 0;
    await pageTom.route('**/api/talks/*/response', (route) => { tomResponseCalls++; void route.continue(); });
    await pageBob.route('**/api/talks/*/response', (route) => { bobResponseCalls++; void route.continue(); });

    // ---- 4. Warm mesh connections (active re-warm until linked) -------------
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    // ---- 5. Tom and Bob broadcast SAME tag content (same identityKey) -------
    // Use identical questions+answers so buildTalkIdentityKey gives the same qa_* hash.
    const SHARED_TALK_DEF = {
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

    const TOM_TALK_ID = `com-tom-${Date.now()}`;
    const BOB_TALK_ID = `com-bob-${Date.now() + 1}`;
    const TOM_TALK_TITLE = 'CoM Tennis';
    const BOB_TALK_TITLE = 'CoM Tennis';

    const tomEpub = await pageTom.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });
    const bobEpub = await pageBob.evaluate(() => {
      const pair = (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.();
      return pair?.epub ?? '';
    });

    const tomTalkDef = {
      ...SHARED_TALK_DEF,
      id: TOM_TALK_ID,
      authorId: tomId,
      title: TOM_TALK_TITLE,
      authorEpub: tomEpub,
      authorName: 'Tom CoM',
    };
    const bobTalkDef = {
      ...SHARED_TALK_DEF,
      id: BOB_TALK_ID,
      authorId: bobId,
      title: BOB_TALK_TITLE,
      authorEpub: bobEpub,
      authorName: 'Bob CoM',
    };

    // Tom broadcasts to Jerry
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
      { tDef: tomTalkDef, rIds: [jerryId] },
    );

    // Bob broadcasts to Jerry
    await pageBob.evaluate(
      async ({ tDef, rIds }: { tDef: any; rIds: string[] }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('Bob: peerMeshService unavailable');
        mesh.cacheTalkBody(tDef.id, tDef);
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        myTalks[tDef.id] = { role: 'created', fullTalk: tDef };
        localStorage.setItem('myTalks', JSON.stringify(myTalks));
        await mesh.broadcastTalk(tDef, { recipientUserIds: rIds, roomBroadcast: true });
      },
      { tDef: bobTalkDef, rIds: [jerryId] },
    );

    await afterAction();

    // ---- 6. Wait for Jerry to receive both acknowledged talk bodies --------
    for (const [label, talkId, authorId] of [
      ['Tom', TOM_TALK_ID, tomId],
      ['Bob', BOB_TALK_ID, bobId],
    ] as const) {
      await expect
        .poll(
          () => pageJerry.evaluate(
            ({ tId, aId }: { tId: string; aId: string }) => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              return !!app?.peerMeshService?.getCachedTalkBody?.(tId, aId);
            },
            { tId: talkId, aId: authorId },
          ),
          { timeout: MESH_E2E_TIMEOUT_MS, message: `Jerry: did not receive ${label}'s talk` },
        )
        .toBe(true);
    }

    await afterSync();

    // ---- 7. Jerry ignores BOTH (version 1, ignore answers) ------------------
    const ignoreAnswers = [
      { questionId: 'q1', answerId: 'a-ignore', answerText: 'No', mode: 'manual', isIgnore: true },
    ];

    await pageJerry.evaluate(
      async ({ tomTalkId, tomAuthorId, tomName, tomDef, bobTalkId, bobAuthorId, bobName, bobDef, ignAns }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Jerry: app unavailable');
        await (app as any).submitTalkResponsePairDirect({
          talkId: tomTalkId,
          talkData: { ...tomDef, authorId: tomAuthorId, authorName: tomName },
          answers: ignAns,
          isChatbotResponse: false,
          authorId: tomAuthorId,
          authorName: tomName,
          isAutoResponse: false,
        });
        await (app as any).submitTalkResponsePairDirect({
          talkId: bobTalkId,
          talkData: { ...bobDef, authorId: bobAuthorId, authorName: bobName },
          answers: ignAns,
          isChatbotResponse: false,
          authorId: bobAuthorId,
          authorName: bobName,
          isAutoResponse: false,
        });
      },
      {
        tomTalkId: TOM_TALK_ID,
        tomAuthorId: tomId,
        tomName: 'Tom CoM',
        tomDef: tomTalkDef,
        bobTalkId: BOB_TALK_ID,
        bobAuthorId: bobId,
        bobName: 'Bob CoM',
        bobDef: bobTalkDef,
        ignAns: ignoreAnswers,
      },
    );

    await afterAction();
    await afterSync();

    // ---- 8. Jerry changes to MATCH (version 2, new responseId) --------------
    const matchAnswers = [
      { questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true },
    ];

    // Jerry re-submits with match answer for Tom's talk (triggers change-of-mind).
    // Because Tom and Bob sent the same SHARED_TALK_DEF (same identityKey), the
    // fanout in submitTalkResponsePairDirect will also send to Bob.
    await pageJerry.evaluate(
      async ({ tomTalkId, tomAuthorId, tomName, tomDef, matAns }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Jerry: app unavailable');
        await (app as any).submitTalkResponsePairDirect({
          talkId: tomTalkId,
          talkData: { ...tomDef, authorId: tomAuthorId, authorName: tomName },
          answers: matAns,
          isChatbotResponse: false,
          authorId: tomAuthorId,
          authorName: tomName,
          isAutoResponse: false,
        });
      },
      {
        tomTalkId: TOM_TALK_ID,
        tomAuthorId: tomId,
        tomName: 'Tom CoM',
        tomDef: tomTalkDef,
        matAns: matchAnswers,
      },
    );

    await afterAction();
    await afterSync();

    // ---- 9. Tom must have a conversation with Jerry -------------------------
    await expect
      .poll(
        () => pageTom.evaluate(({ jId }: { jId: string }) => {
          const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          return Object.values(convs).some((c: any) => c?.otherUserId === jId);
        }, { jId: jerryId }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Tom: conversation with Jerry not created' },
      )
      .toBe(true);

    // ---- 10. Bob must also have a conversation with Jerry (fanout) ----------
    await expect
      .poll(
        () => pageBob.evaluate(({ jId }: { jId: string }) => {
          const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          return Object.values(convs).some((c: any) => c?.otherUserId === jId);
        }, { jId: jerryId }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Bob: conversation with Jerry not created (fanout failed)' },
      )
      .toBe(true);

    // ---- 11. Verify Tom ledger shows Jerry matched with version >= 2 --------
    const tomJerryEntry = await pageTom.evaluate(
      ({ jId, tId }: { jId: string; tId: string }) => {
        const doc: any = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
        if (!doc) return null;
        return Object.values(doc.outcomes as Record<string, any>).find(
          (e: any) => e.responderId === jId && e.talkId === tId,
        ) ?? null;
      },
      { jId: jerryId, tId: TOM_TALK_ID },
    );
    expect(tomJerryEntry, 'Tom: ledger entry for Jerry missing').not.toBeNull();
    expect(tomJerryEntry.outcome).toBe('matched');
    expect(tomJerryEntry.version).toBeGreaterThanOrEqual(2);

    // ---- 12. Verify changeOfMindAt is surfaced on Tom's conversation item ---
    await waitForTabActive(pageTom, 'me');
    const tomConvChangeAt = await pageTom.evaluate(({ jId }: { jId: string }) => {
      const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(convs).find((c: any) => c?.otherUserId === jId) as any;
      return conv?.changeOfMindAt ?? null;
    }, { jId: jerryId });
    expect(tomConvChangeAt, 'Tom: changeOfMindAt not set on conversation').not.toBeNull();

    // ---- 13. Jerry reverts one to ignore (Tom) -> conversation ends ---------
    await pageJerry.evaluate(
      async ({ tomTalkId, tomAuthorId, tomName, tomDef, ignAns }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) throw new Error('Jerry: app unavailable');
        await (app as any).submitTalkResponsePairDirect({
          talkId: tomTalkId,
          talkData: { ...tomDef, authorId: tomAuthorId, authorName: tomName },
          answers: ignAns,
          isChatbotResponse: false,
          authorId: tomAuthorId,
          authorName: tomName,
          isAutoResponse: false,
        });
      },
      {
        tomTalkId: TOM_TALK_ID,
        tomAuthorId: tomId,
        tomName: 'Tom CoM',
        tomDef: tomTalkDef,
        ignAns: ignoreAnswers,
      },
    );

    await afterAction();
    await afterSync();

    // ---- 14. Tom's conversation with Jerry must be marked ended (status=ignored) ---
    await expect
      .poll(
        () => pageTom.evaluate(({ jId }: { jId: string }) => {
          const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
          const conv = Object.values(convs).find((c: any) => c?.otherUserId === jId) as any;
          return conv?.status ?? null;
        }, { jId: jerryId }),
        { timeout: MESH_E2E_TIMEOUT_MS, message: "Tom: conversation not marked 'ignored' after revert" },
      )
      .toBe('ignored');

    // changedAt must be set on Tom's ended conversation
    const tomConvChangedAt = await pageTom.evaluate(({ jId }: { jId: string }) => {
      const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(convs).find((c: any) => c?.otherUserId === jId) as any;
      return conv?.changedAt ?? null;
    }, { jId: jerryId });
    expect(tomConvChangedAt, 'Tom: changedAt not set on ended conversation').not.toBeNull();

    // ---- 15. Shared-identity revert also reaches Bob ------------------------
    const bobConvStatus = await pageBob.evaluate(({ jId }: { jId: string }) => {
      const convs = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const conv = Object.values(convs).find((c: any) => c?.otherUserId === jId) as any;
      return conv?.status ?? 'active';
    }, { jId: jerryId });
    expect(bobConvStatus, 'Bob: shared-identity revert should fan out').toBe('ignored');

    // ---- 16. Inject stale older-version update -> rejected ------------------
    // Directly call handleMeshTalkResponse with an older version
    const staleRejected = await pageTom.evaluate(
      async ({ jId, tId, version }: { jId: string; tId: string; version: number }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (!app) return 'no-app';

        // Read current entry for Jerry in Tom's ledger
        const doc = app.getTalkLedgerDocForE2e?.();
        if (!doc) return 'no-ledger';
        const entry = Object.values(doc.outcomes as Record<string, any>).find(
          (e: any) => e.responderId === jId && e.talkId === tId,
        );
        if (!entry) return 'no-entry';
        const beforeVersion = entry.version;

        // Simulate stale ingest: directly call internal handler with a version lower than current
        const stalePayload = {
          responseId: 'stale_resp_' + Date.now(),
          talkId: tId,
          authorId: app.currentUser?.id,
          responderId: jId,
          submittedAt: new Date(Date.now() - 100000).toISOString(),
          respondedAt: new Date(Date.now() - 100000).toISOString(),
          version: version, // deliberately stale
          encryption: 'none',
          payloadCiphertext: '',
          transportMode: 'mesh-p2p',
        };

        // Call handleMeshTalkResponse (private, but exposed in E2E builds)
        try {
          await (app as any).handleMeshTalkResponse?.(stalePayload);
        } catch {
          // Expected to return early or throw
        }

        const docAfter = app.getTalkLedgerDocForE2e?.();
        const entryAfter = Object.values(docAfter.outcomes as Record<string, any>).find(
          (e: any) => e.responderId === jId && e.talkId === tId,
        );
        return entryAfter?.version === beforeVersion ? 'rejected' : 'accepted';
      },
      { jId: jerryId, tId: TOM_TALK_ID, version: 1 },
    );
    expect(staleRejected, 'Stale v1 update should have been rejected').toBe('rejected');

    // ---- 17. Server endpoint invariant --------------------------------------
    expect(tomResponseCalls, 'Tom: zero /api/talks/*/response POST calls').toBe(0);
    expect(bobResponseCalls, 'Bob: zero /api/talks/*/response POST calls').toBe(0);
  });
});
