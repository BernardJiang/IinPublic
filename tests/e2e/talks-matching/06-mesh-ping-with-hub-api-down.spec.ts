/**
 * L3 acceptance increment: mesh re-forms after hub API loss mid-session.
 *
 * We simulate hub loss by aborting presence/member API calls in all three browsers,
 * tear down each peer's current overlay, rejoin with explicit peer IDs (the mesh's explicit-members
 * mode, as Contacts only uses; Nearby itself links on demand), and verify mesh-ping still propagates.
 */
import { chromium, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { clearGunForStage3Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import { bootstrapUser, enableMeshForwarding, ensureMeshNeighbors, finalCleanupPages } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';

type MeshPingDiagnostics = {
  pingedOrigins: string[];
  pongedOrigins: string[];
  lastPingFrom: string | null;
  lastPongFrom: string | null;
};

const MESH_E2E_TIMEOUT_MS = 30_000;

async function blockHubApi(page: Page): Promise<void> {
  await page.route('**/api/presence/**', async (route) => {
    await route.abort('failed');
  });
  await page.route('**/api/chatrooms/**/members', async (route) => {
    await route.abort('failed');
  });
}

test.describe('Mesh-ping with hub API down mid-session', () => {
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

  test('peers keep mesh-ping reachability after hub API loss', async () => {
    test.setTimeout(180_000);

    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Mesh HubDown', 30_000),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Mesh HubDown', 30_000),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Mesh HubDown', 30_000),
    ]);

    contextTom = tomResult.context;
    contextJerry = jerryResult.context;
    contextBob = bobResult.context;
    pageTom = tomResult.page;
    pageJerry = jerryResult.page;
    pageBob = bobResult.page;

    await afterLoad();
    await afterSync();

    const tomId = await pageTom.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const jerryId = await pageJerry.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );
    const bobId = await pageBob.evaluate(() =>
      String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''),
    );

    // Pings relay through a third peer; that forwarding is opt-in (off by default).
    await enableMeshForwarding([pageTom, pageJerry, pageBob]);
    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    await Promise.all([blockHubApi(pageTom), blockHubApi(pageJerry), blockHubApi(pageBob)]);

    // Tear down and re-form overlay after hub API loss.
    await pageTom.evaluate(async ([jId, bId]: [string, string]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      mesh.leaveRoom?.();
      const members = [{ userId: app.currentUser?.id }, { userId: jId }, { userId: bId }];
      // Explicit links to the named peers: Nearby's own mode links only on demand (§3.7).
      await mesh.joinRoom(roomId, members, { personal: false, replace: true });
    }, [jerryId, bobId]);

    await pageJerry.evaluate(async ([tId, bId]: [string, string]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      mesh.leaveRoom?.();
      const members = [{ userId: app.currentUser?.id }, { userId: tId }, { userId: bId }];
      // Explicit links to the named peers: Nearby's own mode links only on demand (§3.7).
      await mesh.joinRoom(roomId, members, { personal: false, replace: true });
    }, [tomId, bobId]);

    await pageBob.evaluate(async ([tId, jId]: [string, string]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      mesh.leaveRoom?.();
      const members = [{ userId: app.currentUser?.id }, { userId: tId }, { userId: jId }];
      // Explicit links to the named peers: Nearby's own mode links only on demand (§3.7).
      await mesh.joinRoom(roomId, members, { personal: false, replace: true });
    }, [tomId, jerryId]);

    await expect
      .poll(
        () =>
          pageTom.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
          }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: 'Tom did not re-form neighbors' },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(
        () =>
          pageJerry.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
          }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: 'Jerry did not re-form neighbors' },
      )
      .toBeGreaterThan(0);

    await expect
      .poll(
        () =>
          pageBob.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            return app?.peerMeshService?.getDiagnostics?.()?.connectedNeighborCount ?? 0;
          }),
        { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: 'Bob did not re-form neighbors' },
      )
      .toBeGreaterThan(0);

    // Mesh frames go only to manifest-ready neighbors, and leaveRoom() cleared readiness; a ping
    // sent before the re-formed links finish the manifest exchange would reach no one.
    for (const [label, page] of [['Tom', pageTom], ['Jerry', pageJerry], ['Bob', pageBob]] as const) {
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const app = (window as any).__iinpublic_app?.getApp?.() as any;
              return app?.peerMeshService?.getDiagnostics?.()?.manifestReadyNeighborCount ?? 0;
            }),
          { timeout: MESH_E2E_TIMEOUT_MS, intervals: [200, 400, 800], message: `${label}: no manifest-ready neighbor` },
        )
        .toBeGreaterThan(0);
    }

    await afterAction();
    await afterSync();

    // Reset diagnostics so this assertion only captures post-hub-loss pings.
    await Promise.all([pageTom, pageJerry, pageBob].map((page) =>
      page.evaluate(() => {
        const app = (window as any).__iinpublic_app?.getApp?.() as any;
        const diag = app?.meshPingDiagnostics as MeshPingDiagnostics | undefined;
        if (!diag) return;
        diag.pingedOrigins = [];
        diag.pongedOrigins = [];
        diag.lastPingFrom = null;
        diag.lastPongFrom = null;
      }),
    ));

    await pageTom.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      return app?.peerMeshService?.sendPing?.('l3-hub-api-down');
    });

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
            message: `${label}: did not receive mesh-ping after hub API loss`,
          },
        )
        .toBe(true);
    }

    // Pongs are addressed to Tom, and authoritative direct delivery never relays a
    // recipient-addressed frame through a third peer (forwardFrame). So Tom hears a pong from each
    // peer it is directly linked to; the relayed ping above already proves multi-hop reach.
    await expect
      .poll(
        () =>
          pageTom.evaluate(() => {
            const app = (window as any).__iinpublic_app?.getApp?.() as any;
            const mesh = app?.peerMeshService as any;
            const diag = app?.meshPingDiagnostics as MeshPingDiagnostics | undefined;
            const linked = [...(mesh?.neighbors?.values?.() ?? [])]
              .filter((neighbor: any) => neighbor.connected)
              .map((neighbor: any) => String(neighbor.userId));
            return linked.length > 0 && linked.every((userId) => diag?.pongedOrigins?.includes(userId));
          }),
        {
          timeout: MESH_E2E_TIMEOUT_MS,
          intervals: [200, 400, 800],
          message: 'Tom: no pong from a directly linked peer after hub API loss',
        },
      )
      .toBe(true);
  });
});
