/**
 * P0 step 1 — mesh-ping overlay (three browsers, sparse DataChannel graph).
 *
 * Three browser peers form a sparse overlay seeded from Socket.IO room presence
 * and an originator's `mesh-ping` reaches every other peer via gossip forwarding
 * with zero `talks/*` or `peerTalkOffers/*` Gun writes.
 *
 * See companion 01-mesh-ping-overlay.md for a plain-English description.
 */
import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage3Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import { bootstrapUser, ensureMeshNeighbors, finalCleanupPages } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../helpers/ports';

/** Collect all non-metadata keys under a Gun root over a 500ms window. */
const COLLECT_GUN_WINDOW_MS = 500;

type MeshPingDiagnostics = {
  pingedOrigins: string[];
  pongedOrigins: string[];
  lastPingFrom: string | null;
  lastPongFrom: string | null;
};

/** Timeout for WebRTC overlay formation and ping propagation (per design §7 R-d). */
const MESH_E2E_TIMEOUT_MS = 30_000;

test.describe('Mesh-ping overlay — three browser peers, zero Gun writes', () => {
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(180_000);
    await clearGunForStage3Spec();
    // Launch with WebRTC mDNS flag so split-browser DataChannels work on loopback.
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

  test('mesh-ping reaches all three peers and no forbidden Gun writes occur', async () => {
    test.setTimeout(180_000);

    // --- Setup: bootstrap all three users in the same stable chatroom ---
    void webAppURLStableChatroom(); // ensures e2e_mesh_talks=1 is in URL via webAppURLStableChatroom()
    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Mesh'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Mesh'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Mesh'),
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

    // --- Sub-case 1: actively warm mesh links until ≥1 connected neighbor on each peer ---
    // ensureMeshNeighbors re-issues warmMeshConnectionToPeer while polling, so a
    // timed-out first WebRTC cycle under parallel load recovers instead of flaking.
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    // --- Sub-case 2: K=1 sparse path — re-join with maxNeighbors:1 ---
    // Override opts.maxNeighbors in-place, then call joinRoom with current room members.
    // This tests the forwarding rule: Tom's ping must reach Bob via one hop through Jerry.
    await pageTom.evaluate(async ([jId, bId]: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      // Override degree bound to K=1
      (mesh as any).opts = { ...(mesh as any).opts, maxNeighbors: 1 };
      // Provide member list with known peers so joinRoom can select one neighbor
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

    // Wait for that 1 neighbor to be connected before sending the ping
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

    // --- Step 3: Tom sends mesh-ping ---
    await afterAction();
    await pageTom.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      return app?.peerMeshService?.sendPing?.('p0-step1');
    });

    // --- Step 4: Durable reachability assertions via meshPingDiagnostics (design §6) ---
    // Jerry and Bob poll pingedOrigins.includes(tomId) — robust to ordering and to keepalive
    // pings from other peers that may overwrite lastPingFrom before the assertion fires.
    // frame.originUserId (not fromUserId) is stored by onPing, so even forwarded pings
    // correctly attribute the origin (spec §23.4).
    for (const [label, page] of [['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect
        .poll(
          () =>
            page.evaluate((tId: string) => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              const diag = app?.meshPingDiagnostics as MeshPingDiagnostics | undefined;
              return diag?.pingedOrigins?.includes(tId) ?? false;
            }, tomId),
          {
            timeout: MESH_E2E_TIMEOUT_MS,
            intervals: [200, 400, 800],
            message: `${label}: did not receive mesh-ping from Tom`,
          },
        )
        .toBe(true);
    }

    // Tom polls pongedOrigins — proves round-trip reachability from both peers
    await expect
      .poll(
        () =>
          pageTom.evaluate((jId: string) => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            const diag = app?.meshPingDiagnostics as MeshPingDiagnostics | undefined;
            return diag?.pongedOrigins?.includes(jId) ?? false;
          }, jerryId),
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          intervals: [200, 400, 800],
          message: 'Tom: no pong from Jerry',
        },
      )
      .toBe(true);

    await expect
      .poll(
        () =>
          pageTom.evaluate((bId: string) => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            const diag = app?.meshPingDiagnostics as MeshPingDiagnostics | undefined;
            return diag?.pongedOrigins?.includes(bId) ?? false;
          }, bobId),
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          intervals: [200, 400, 800],
          message: 'Tom: no pong from Bob',
        },
      )
      .toBe(true);

    // --- Step 5: Invariant assertion — zero Gun writes to forbidden paths (design §4) ---
    // Pattern reused from 00i-p0-direct-talk-delivery.spec.ts L76-129
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
        async ({ receiverId, collectFn }: { receiverId: string; collectFn: string }) => {
          const app = (window as any).__iinpublic_app?.getApp?.() as any;
          const gun = app?.gunService?.getGun?.();
          if (!gun) return { talkOffers: 0, talksRoot: 0, talkOffersRoot: 0 };
          // eslint-disable-next-line no-new-func
          // Parenthesize: collectFn starts with a newline, and `return\n(...)` hits ASI (returns undefined)
          const collect = new Function(`return (${collectFn})`)() as (root: any) => Promise<any[]>;
          const [talkOffers, talksRoot, talkOffersRoot] = await Promise.all([
            collect(gun.get('peerTalkOffers').get(receiverId)),
            collect(gun.get('talks')),
            collect(gun.get('peerTalkOffers')),
          ]);
          return {
            talkOffers: talkOffers.length,
            talksRoot: talksRoot.length,
            talkOffersRoot: talkOffersRoot.length,
          };
        },
        { receiverId: rid, collectFn: collectFnSrc },
      );

      expect(gunCounts.talkOffers, `${label}: peerTalkOffers[receiverId] must be 0`).toBe(0);
      expect(gunCounts.talksRoot, `${label}: talks/* must be 0`).toBe(0);
      expect(gunCounts.talkOffersRoot, `${label}: peerTalkOffers/* must be 0`).toBe(0);
    }
  });
});
