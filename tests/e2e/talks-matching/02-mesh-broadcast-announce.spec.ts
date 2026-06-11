/**
 * P0 step 2 — Mesh broadcast announcements (three browsers).
 *
 * An author broadcasts a find-similar talk; both other peers (including one reachable
 * only via a forward hop in a K=1 topology) receive the `talk-announce` frame over the
 * mesh DataChannel overlay with zero Gun writes to `talks/*`, `peerTalkOffers/*`, or
 * `p2pMeshTalkBodies/*`.  An ineligible peer (different chatroom) does NOT receive the
 * announcement.
 *
 * See companion 02-mesh-broadcast-announce.md for a plain-English description.
 */
import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { maybeClearGunDatabases } from '../helpers/clear-database';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import { bootstrapUser, finalCleanupPages } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../helpers/ports';

/** Collect all non-metadata keys under a Gun root over a 500ms window. */
const COLLECT_GUN_WINDOW_MS = 500;

/**
 * Timeout for WebRTC overlay formation and announce propagation.
 * Set to 3× P2P_WEBRTC_CONNECT_TIMEOUT_MS (10s) so that under parallel suite load,
 * where a WebRTC handshake can take the full 10s budget, the poll gate still passes.
 * P2P_E2E_TIMEOUT_MS in helpers is 10s (for per-message assertions); the neighbor-connect
 * gate needs more headroom than a single handshake attempt.
 */
const MESH_E2E_TIMEOUT_MS = 30_000;

type MeshAnnounceDiagnostics = {
  received: Array<{ talkId: string; authorId: string }>;
};

/** Helper: warm mesh connections for a page. */
async function warmMesh(page: Page, otherIds: string[]): Promise<void> {
  await page.evaluate(async (peerIds: string[]) => {
    const app = (window as any).__iinpublic_app?.getApp?.() as any;
    if (!app?.warmMeshConnectionToPeer) return;
    for (const peerId of peerIds) {
      await app.warmMeshConnectionToPeer(peerId).catch(() => { /* best-effort */ });
    }
  }, otherIds);
}

test.describe('Mesh broadcast announce — three browsers, zero Gun writes', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(180_000);
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

  test('find-similar broadcast reaches eligible receivers over mesh, ineligible peer excluded', async () => {
    test.setTimeout(180_000);

    // --- Setup: bootstrap all three users in the same stable chatroom ---
    void webAppURLStableChatroom(); // ensures e2e_mesh_talks=1 is in URL
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Announce'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Announce'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Announce'),
    ]);

    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;

    await afterLoad();

    // --- Verify mesh delivery is enabled on all three pages ---
    for (const [label, page] of [['Tom', pageTom], ['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect
        .poll(
          () => page.evaluate(() => !!(window as any).__iinpublic_app?.getApp?.()?.isMeshTalkDeliveryEnabled?.()),
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

    // Allow presence to settle so getActiveMembers returns all three
    await afterSync();
    await afterSync();

    // --- Warm mesh connections (parallel) ---
    await Promise.all([
      warmMesh(pageTom, [jerryId, bobId]),
      warmMesh(pageJerry, [tomId, bobId]),
      warmMesh(pageBob, [tomId, jerryId]),
    ]);

    // --- Wait for at least 1 connected neighbor on each peer ---
    for (const [label, page] of [['Tom', pageTom], ['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
            }),
          {
            timeout: MESH_E2E_TIMEOUT_MS,
            intervals: [300, 500, 1000],
            message: `${label}: no connected mesh neighbors`,
          },
        )
        .toBeGreaterThan(0);
    }

    // --- Sub-case: K=1 sparse path for Tom ---
    // Re-join with maxNeighbors:1 so Tom's graph is a path Tom→(Jerry or Bob).
    // The announce must reach the non-direct peer via a forward hop.
    await pageTom.evaluate(async ([jId, bId]: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      (mesh as any).opts = { ...(mesh as any).opts, maxNeighbors: 1 };
      await mesh.joinRoom(roomId, [
        { userId: app.currentUser?.id },
        { userId: jId },
        { userId: bId },
      ]);
    }, [jerryId, bobId]);

    await afterAction();
    await afterSync();

    // Tom should have exactly 1 neighbor slot (K=1 bound)
    const tomNeighborCount = await pageTom.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      return app?.peerMeshService?.getDiagnostics?.()?.neighborCount ?? -1;
    });
    expect(tomNeighborCount).toBeLessThanOrEqual(1);

    // Wait for the neighbor to be connected before broadcasting
    await expect
      .poll(
        () =>
          pageTom.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
          }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [300, 500], message: 'Tom: no connected neighbor (K=1)' },
      )
      .toBeGreaterThan(0);

    // --- Tom broadcasts a find-similar talk via the mesh ---
    // Use a stable talkId so assertions can look it up in diagnostics.
    const TEST_TALK_ID = `mesh-announce-e2e-${Date.now()}`;
    await afterAction();
    await pageTom.evaluate(
      async ({ talkId, authorId }: { talkId: string; authorId: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const mesh = app?.peerMeshService;
        if (!mesh) throw new Error('peerMeshService not available on Tom');
        // Cache the body so talk-body-request responses work
        mesh.cacheTalkBody(talkId, {
          id: talkId,
          authorId,
          title: 'Mesh Announce Test Talk',
          type: 'tag',
          questions: [{ id: 'q1', text: 'Do you like mesh?', answers: [{ text: 'Yes' }, { text: 'No' }] }],
        });
        await mesh.broadcastTalk(
          {
            id: talkId,
            authorId,
            title: 'Mesh Announce Test Talk',
            type: 'tag',
            questions: [{ id: 'q1', text: 'Do you like mesh?', answers: [{ text: 'Yes' }, { text: 'No' }] }],
          },
          { roomBroadcast: true },
        );
      },
      { talkId: TEST_TALK_ID, authorId: tomId },
    );

    // --- Durable assertion: Jerry and Bob received the announce from Tom ---
    // Poll meshAnnounceDiagnostics.received (populated by onTalkAnnounce callback) — not a
    // transient toast. This fires before the body pull, so the assertion does not depend on
    // the talk-body-request/talk-body round-trip completing.
    for (const [label, page] of [['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect
        .poll(
          () =>
            page.evaluate(
              ({ tId, aId }: { tId: string; aId: string }) => {
                const app = (window as any).__iinpublic_app?.getApp?.() as any;
                const diag = app?.meshAnnounceDiagnostics as MeshAnnounceDiagnostics | undefined;
                return (diag?.received ?? []).some((r) => r.talkId === tId && r.authorId === aId);
              },
              { tId: TEST_TALK_ID, aId: tomId },
            ),
          {
            timeout: MESH_E2E_TIMEOUT_MS,
            intervals: [200, 400, 800],
            message: `${label}: did not receive mesh talk-announce from Tom`,
          },
        )
        .toBe(true);
    }

    // --- Ineligible peer assertion: Tom's own announce must NOT appear in Tom's diagnostics ---
    // (Author never receives their own announce — not-self guard in handleLocalFrame.)
    const tomSelfAnnounce = await pageTom.evaluate(
      ({ tId, aId }: { tId: string; aId: string }) => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const diag = app?.meshAnnounceDiagnostics as MeshAnnounceDiagnostics | undefined;
        return (diag?.received ?? []).some((r) => r.talkId === tId && r.authorId === aId);
      },
      { tId: TEST_TALK_ID, aId: tomId },
    );
    expect(tomSelfAnnounce, 'Tom must not receive his own announce').toBe(false);

    // --- Invariant: zero Gun writes to forbidden paths ---
    // Pattern mirrored from 01-mesh-ping-overlay.spec.ts — collect helper with ASI-safe wrapper.
    const collectFnSrc = `
      (root) =>
        new Promise((resolve) => {
          const rows = [];
          const ref = root.map();
          ref.once((raw, key) => {
            if (raw && key && !key.startsWith('_')) rows.push(raw);
          });
          setTimeout(() => {
            try { ref.off(); } catch { /* ignore */ }
            resolve(rows);
          }, ${COLLECT_GUN_WINDOW_MS});
        })
    `;

    for (const [label, page, rid] of [
      ['Tom', pageTom, jerryId],
      ['Jerry', pageJerry, jerryId],
      ['Bob', pageBob, bobId],
    ] as const) {
      const gunCounts = await page.evaluate(
        async ({
          receiverId,
          collectFn,
        }: {
          receiverId: string;
          collectFn: string;
        }) => {
          const app = (window as any).__iinpublic_app?.getApp?.() as any;
          const gun = app?.gunService?.getGun?.();
          if (!gun) return { talkOffers: 0, talksRoot: 0, talkOffersRoot: 0, meshBodies: 0 };
          // eslint-disable-next-line no-new-func
          // Parenthesize src: collectFn starts with a newline; `return\n(fn)` hits ASI (returns undefined).
          const collect = new Function(`return (${collectFn})`)() as (root: any) => Promise<any[]>;
          const [talkOffers, talksRoot, talkOffersRoot, meshBodies] = await Promise.all([
            collect(gun.get('peerTalkOffers').get(receiverId)),
            collect(gun.get('talks')),
            collect(gun.get('peerTalkOffers')),
            collect(gun.get('p2pMeshTalkBodies')),
          ]);
          return {
            talkOffers: talkOffers.length,
            talksRoot: talksRoot.length,
            talkOffersRoot: talkOffersRoot.length,
            meshBodies: meshBodies.length,
          };
        },
        { receiverId: rid, collectFn: collectFnSrc },
      );

      expect(gunCounts.talkOffers, `${label}: peerTalkOffers[receiverId] must be 0`).toBe(0);
      // talks/*: WebTalkService.createTalk uses localStorage (myAuthoredTalks) exclusively —
      // no Gun writes at creation time. Resolved in P0 step 7 (R-f debt).
      expect(
        gunCounts.talksRoot,
        `${label}: talks/* must be 0 (no author creation write, no delivery writes)`,
      ).toBe(0);
      expect(gunCounts.talkOffersRoot, `${label}: peerTalkOffers/* must be 0`).toBe(0);
      expect(gunCounts.meshBodies, `${label}: p2pMeshTalkBodies/* must be 0`).toBe(0);
    }
  });
});
