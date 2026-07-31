/**
 * L3 acceptance: process-level hub interruption mid-session.
 *
 * This spec requires a manually managed server process (not Playwright webServer)
 * so the test can terminate the hub process during execution.
 */
import { chromium, BrowserContext, Page, expect, test } from '@playwright/test';
import { clearGunForStage3Spec } from '../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, afterAction } from '../helpers/timing';
import {
  shutdownThreeBrowsers,
  type ThreeBrowsers,
} from '../helpers/talks-matching-browsers';
import { bootstrapUser, ensureMeshNeighbors, finalCleanupPages } from '../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { gunBaseURL } from '../helpers/ports';

type MeshPingDiagnostics = {
  pingedOrigins: string[];
  pongedOrigins: string[];
  lastPingFrom: string | null;
  lastPongFrom: string | null;
};

const MESH_E2E_TIMEOUT_MS = 30_000;

async function stopHubProcess(): Promise<void> {
  const res = await fetch(`${gunBaseURL()}/api/test/shutdown-hub`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ delayMs: 120 }),
  });
  expect(res.status).toBe(202);
}

test.describe('Mesh-ping after process-level hub stop', () => {
  // retries:0 is intentional — the spec stops the hub via `/api/test/shutdown-hub`,
  // which does `process.exit(0)` with NO restart. A retry would re-run bootstrap
  // against a dead hub and fail, so retrying is futile (not a contention fix).
  test.describe.configure({ retries: 0 });
  let browsers: ThreeBrowsers;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({}) => {
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
  });

  test('overlay remains reachable and ping reaches peers after hub process stops', async () => {
    test.setTimeout(180_000);

    const [tomResult, jerryResult, bobResult] = await Promise.all([
      bootstrapUser(browsers.tom, 'Tom', 'Tom Hub Stop'),
      bootstrapUser(browsers.jerry, 'Jerry', 'Jerry Hub Stop'),
      bootstrapUser(browsers.bob, 'Bob', 'Bob Hub Stop'),
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

    await ensureMeshNeighbors([
      { label: 'Tom', page: pageTom, otherIds: [jerryId, bobId] },
      { label: 'Jerry', page: pageJerry, otherIds: [tomId, bobId] },
      { label: 'Bob', page: pageBob, otherIds: [tomId, jerryId] },
    ]);

    await stopHubProcess();

    await expect
      .poll(
        async () => {
          try {
            const r = await fetch(`${gunBaseURL()}/health`, { cache: 'no-store' });
            return r.ok;
          } catch {
            return false;
          }
        },
        {
          timeout: 10_000,
          intervals: [200, 400, 800],
          message: 'Hub process did not stop in expected time',
        },
      )
      .toBe(false);

    await pageTom.evaluate(async ([jId, bId]: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      await mesh.joinRoom(roomId, [
        { userId: app.currentUser?.id },
        { userId: jId },
        { userId: bId },
      ]);
    }, [jerryId, bobId]);

    await pageJerry.evaluate(async ([tId, bId]: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      await mesh.joinRoom(roomId, [
        { userId: app.currentUser?.id },
        { userId: tId },
        { userId: bId },
      ]);
    }, [tomId, bobId]);

    await pageBob.evaluate(async ([tId, jId]: string[]) => {
      const app = (window as any).__iinpublic_app?.getApp?.() as any;
      const mesh = app?.peerMeshService;
      if (!mesh) return;
      const roomId = mesh.getDiagnostics?.()?.roomId ?? 'global';
      await mesh.joinRoom(roomId, [
        { userId: app.currentUser?.id },
        { userId: tId },
        { userId: jId },
      ]);
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

    await afterAction();
    await afterSync();

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
      return app?.peerMeshService?.sendPing?.('l3-hub-process-stop');
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
            message: `${label}: did not receive mesh-ping after hub stop`,
          },
        )
        .toBe(true);
    }

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
          message: 'Tom: no pong from Jerry after hub stop',
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
          message: 'Tom: no pong from Bob after hub stop',
        },
      )
      .toBe(true);
  });
});
