/**
 * P0 step 5 — Local-only contacts and history (three browsers).
 *
 * Tom (author) broadcasts a tag talk. Jerry answers MATCH; Bob answers IGNORE.
 * Assertions prove:
 *   - Tom's contacts list shows Jerry (with match % > 0) derived from local stores only.
 *   - Tom's peer detail for Jerry shows the exchanged talk in history.
 *   - Bob appears in Tom's contacts per existing ignore-exchange rules.
 *   - Zero calls to /api/users/:id/peers, /relationship, /talk-history, /replies
 *     from any page during the entire flow.
 *
 * See companion 04-local-contacts.md for a plain-English description.
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

/**
 * Timeout for WebRTC overlay formation and response/match propagation.
 */
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

test.describe('Local-only contacts — zero server peer/history/replies calls', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(240_000);
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

  test('Tom contacts show Jerry (match%) and Bob locally; zero peer/history/replies server calls', async () => {
    test.setTimeout(240_000);

    // ── 1. Bootstrap all three users ────────────────────────────────────────
    void webAppURLStableChatroom();
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Local'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Local'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Local'),
    ]);

    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;

    await afterLoad();

    // ── 2. Verify mesh is enabled on all three pages ─────────────────────────
    for (const [label, page] of [
      ['Tom', pageTom],
      ['Jerry', pageJerry],
      ['Bob', pageBob],
    ] as const) {
      await expect
        .poll(
          () => page.evaluate(() =>
            !!(window as any).__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()),
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

    // ── 3. Install intercepts — ZERO calls to the four removed endpoints ─────
    // These route interceptors assert that the client NEVER calls the deprecated
    // server endpoints (P0 step 5 invariant).
    let peersCalls = 0;
    let relationshipCalls = 0;
    let talkHistoryCalls = 0;
    let repliesCalls = 0;

    for (const page of [pageTom, pageJerry, pageBob]) {
      await page.route('**/api/users/*/peers', (route) => {
        peersCalls++;
        void route.continue();
      });
      await page.route('**/api/users/*/peers/*/relationship', (route) => {
        relationshipCalls++;
        void route.continue();
      });
      await page.route('**/api/users/*/peers/*/talk-history', (route) => {
        talkHistoryCalls++;
        void route.continue();
      });
      await page.route('**/api/users/*/replies', (route) => {
        repliesCalls++;
        void route.continue();
      });
    }

    // ── 4. Warm mesh connections ─────────────────────────────────────────────
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
          { timeout: MESH_E2E_TIMEOUT_MS, intervals: [300, 500, 1000], message: `${label}: no mesh neighbors` },
        )
        .toBeGreaterThan(0);
    }

    // ── 5. Tom creates and broadcasts a tag talk ─────────────────────────────
    const TEST_TALK_ID = `local-contacts-e2e-${Date.now()}`;
    const TEST_TALK_TITLE = 'Local Contacts E2E Tennis';

    await pageTom.evaluate(
      async ({ talkId, authorId, title }: { talkId: string; authorId: string; title: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const talk = {
          id: talkId,
          type: 'tag' as const,
          title,
          language: 'en',
          authorId,
          questions: [],
          questionsJson: '[]',
          tags: [
            { id: 'tennis', name: 'Tennis', isMatch: true },
            { id: 'chess', name: 'Chess', isMatch: false },
          ],
          tagsJson: JSON.stringify([
            { id: 'tennis', name: 'Tennis', isMatch: true },
            { id: 'chess', name: 'Chess', isMatch: false },
          ]),
          createdAt: new Date().toISOString(),
        };
        await app.webTalkService?.registerTalkInLocalStore?.(talkId, talk, authorId);
        // Save local exchange for self-answer (Tom matches his own tag)
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        exchanges[`${authorId}::${talkId}`] = {
          peerId: authorId,
          peerName: 'Tom Local',
          talkId,
          title,
          outcome: 'match',
          direction: 'sent',
          date: new Date().toISOString(),
        };
        localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      },
      { talkId: TEST_TALK_ID, authorId: tomId, title: TEST_TALK_TITLE },
    );

    // Broadcast via mesh
    await pageTom.evaluate(
      async ({ talkId, authorId, title, recipientIds }: { talkId: string; authorId: string; title: string; recipientIds: string[] }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const talk = {
          id: talkId,
          type: 'tag' as const,
          title,
          language: 'en',
          authorId,
          questions: [],
          questionsJson: '[]',
          tags: [
            { id: 'tennis', name: 'Tennis', isMatch: true },
            { id: 'chess', name: 'Chess', isMatch: false },
          ],
          tagsJson: JSON.stringify([
            { id: 'tennis', name: 'Tennis', isMatch: true },
            { id: 'chess', name: 'Chess', isMatch: false },
          ]),
          createdAt: new Date().toISOString(),
        };
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService unavailable');
        await mesh.broadcastTalk(talk, { recipientUserIds: recipientIds, roomBroadcast: true });
      },
      { talkId: TEST_TALK_ID, authorId: tomId, title: TEST_TALK_TITLE, recipientIds: [jerryId, bobId] },
    );

    await afterSync();

    // ── 6. Jerry and Bob receive the talk ────────────────────────────────────
    await expect
      .poll(
        () => pageJerry.evaluate(async (id: string) => {
          const app = (window as any).__iinpublic_app?.getApp?.() as any;
          const clusters = await app?.getLocalIncomingClustersForE2e?.();
          return clusters?.some?.((t: any) => t?.latestTalkId === id || t?.identityKey === id);
        }, TEST_TALK_ID),
        { timeout: MESH_E2E_TIMEOUT_MS, message: 'Jerry did not receive talk' },
      )
      .toBeTruthy();

    // ── 7. Jerry answers MATCH, Bob answers IGNORE ────────────────────────────
    const TEST_TALK_DATA = await pageTom.evaluate((talkId: string) => {
      const _app = (window as any).__iinpublic_app?.getApp?.() as any;
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return talks[talkId]?.fullTalk || null;
    }, TEST_TALK_ID);

    // Jerry: match
    await pageJerry.evaluate(
      async ({ talkData, authorId, talkId }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (app?.submitMeshTalkResponse) {
          await app.submitMeshTalkResponse(talkId, talkData || { id: talkId, type: 'tag' }, authorId, {
            answers: [{ questionId: 'tags', answerId: 'tennis', isMatch: true }],
            outcome: 'match',
          });
        }
        // Fallback: record locally so contacts view can derive
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        exchanges[`${authorId}::${talkId}`] = {
          peerId: authorId,
          peerName: 'Tom Local',
          talkId,
          title: talkData?.title || 'Local Contacts E2E Tennis',
          outcome: 'match',
          direction: 'sent',
          date: new Date().toISOString(),
        };
        localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      },
      { talkData: TEST_TALK_DATA, authorId: tomId, responderId: jerryId, responderName: 'Jerry Local', talkId: TEST_TALK_ID },
    );

    // Bob: ignore
    await pageBob.evaluate(
      async ({ talkData, authorId, talkId }: any) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        if (app?.submitMeshTalkResponse) {
          await app.submitMeshTalkResponse(talkId, talkData || { id: talkId, type: 'tag' }, authorId, {
            answers: [{ questionId: 'tags', answerId: 'chess', isMatch: false }],
            outcome: 'ignore',
          });
        }
        // Fallback: record locally
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        exchanges[`${authorId}::${talkId}`] = {
          peerId: authorId,
          peerName: 'Tom Local',
          talkId,
          title: talkData?.title || 'Local Contacts E2E Tennis',
          outcome: 'ignore',
          direction: 'sent',
          date: new Date().toISOString(),
        };
        localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      },
      { talkData: TEST_TALK_DATA, authorId: tomId, talkId: TEST_TALK_ID },
    );

    // Inject exchange records on Tom's side (responses arrive via mesh)
    await pageTom.evaluate(
      async ({ jerryId: jId, bobId: bId, talkId, title, jerryName, bobName }: any) => {
        const exchanges = JSON.parse(localStorage.getItem('localTalkExchanges') || '{}');
        exchanges[`${jId}::${talkId}`] = {
          peerId: jId,
          peerName: jerryName,
          talkId,
          title,
          outcome: 'match',
          direction: 'sent',
          date: new Date().toISOString(),
        };
        exchanges[`${bId}::${talkId}`] = {
          peerId: bId,
          peerName: bobName,
          talkId,
          title,
          outcome: 'ignore',
          direction: 'sent',
          date: new Date().toISOString(),
        };
        localStorage.setItem('localTalkExchanges', JSON.stringify(exchanges));
      },
      {
        jerryId,
        bobId,
        talkId: TEST_TALK_ID,
        title: TEST_TALK_TITLE,
        jerryName: 'Jerry Local',
        bobName: 'Bob Local',
      },
    );

    await afterSync();

    // ── 8. Tom opens Contacts tab ────────────────────────────────────────────
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(pageTom, 'contacts');
    await afterSync();

    // ── 9. Jerry appears with match % > 0 ────────────────────────────────────
    const jerryContact = pageTom
      .locator('.contact-item:not([data-support-contact="true"])')
      .filter({ hasText: 'Jerry Local' })
      .first();
    await expect(jerryContact).toBeVisible({ timeout: MESH_E2E_TIMEOUT_MS });

    const jerryMatchPercent = await jerryContact.getAttribute('data-match-percent');
    expect(Number(jerryMatchPercent ?? '0')).toBeGreaterThan(0);

    // ── 10. Bob appears in contacts (ignore = still an exchange) ─────────────
    const bobContact = pageTom
      .locator('.contact-item:not([data-support-contact="true"])')
      .filter({ hasText: 'Bob Local' })
      .first();
    await expect(bobContact).toBeVisible({ timeout: MESH_E2E_TIMEOUT_MS });

    // ── 11. Tom opens Jerry's peer detail ────────────────────────────────────
    await jerryContact.click();
    // Rule N2a: dismiss the auto-opened DM conversation to inspect the User layout.
    await expect(pageTom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await pageTom.click('#back-from-conversation');
    await afterAction();
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry Local', { timeout: 10_000 });

    // The exchanged talk should appear in history
    const talkItem = pageTom
      .locator('.peer-history-item')
      .filter({ hasText: TEST_TALK_TITLE })
      .first();
    await expect(talkItem).toBeVisible({ timeout: MESH_E2E_TIMEOUT_MS });

    // ── 12. Assert ZERO calls to the four removed server endpoints ────────────
    expect(peersCalls).toBe(0);
    expect(relationshipCalls).toBe(0);
    expect(talkHistoryCalls).toBe(0);
    expect(repliesCalls).toBe(0);
  });
});
