import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';
import SEA from 'gun/sea';

test.describe('P2P roadmap P5 — cross-platform node protocol', () => {
  // Allowlist: pending G-fix (add connectedNeighborCount gate) — see docs/testing/retry-dependence-inventory.md
  test.describe.configure({ retries: 1 });
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('debug storage and discovery endpoint define signed platform compatibility', async ({ request }) => {
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const payload = await storage.json();
    expect(payload.p2pNetworkProtocol).toEqual(
      expect.objectContaining({
        version: 1,
        substrate: 'gun-mesh-websocket-webrtc',
        capabilities: expect.arrayContaining(['signed-discovery', 'encrypted-signaling', 'webrtc-datachannel']),
      }),
    );
    expect(payload.p2pNetworkProtocol.platforms.map((item: { platform: string }) => item.platform)).toEqual([
      'web',
      'windows',
      'ubuntu',
      'android',
      'ios',
    ]);

    // L6: discovery endpoint has been deleted
    const discoveryGet = await request.get(`${gunBaseURL()}/api/p2p/discovery`);
    expect(discoveryGet.status()).toBe(404);

    const discoveryPost = await request.post(`${gunBaseURL()}/api/p2p/discovery`, {
      data: {
        platform: 'web',
        senderPub: 'pub_web',
        capabilities: ['signed-discovery'],
        endpointHints: ['webrtc:room'],
      },
    });
    expect(discoveryPost.status()).toBe(404);

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-p2p-protocol')).toBeVisible();
    await expect(p.locator('#storage-inspector-p2p-protocol')).toContainText('gun-mesh-websocket-webrtc');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('windows');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('android');
    await expect(p.locator('#storage-inspector-p2p-platforms')).toContainText('ios');
    await expect(p.locator('#storage-inspector-p2p-capabilities')).toContainText('signed-discovery');
  });
});
