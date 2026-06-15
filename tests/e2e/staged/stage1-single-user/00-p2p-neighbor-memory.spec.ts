import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import {injectIdbClear, gotoWebApp} from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P6 — active neighbor memory', () => {
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

  test('remembers active neighbors locally and uses them before star fallback', async ({ request }) => {
    const futureExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const storage = await request.get(`${gunBaseURL()}/api/debug/storage`);
    expect(storage.ok()).toBeTruthy();
    const debug = await storage.json();
    expect(debug.neighborMemory.controls).toEqual(
      expect.objectContaining({
        enabled: true,
        localOnly: true,
        privateGraphPublishedByDefault: false,
      }),
    );

    const remembered = await request.post(`${gunBaseURL()}/api/p2p/neighbors`, {
      data: {
        peerId: 'pub_fast_contact',
        endpointHints: ['webrtc:fast-contact'],
        lastSeenAt: '2026-05-20T00:00:00.000Z',
        successfulSessions: 5,
        latencyMs: 25,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery', 'webrtc-datachannel'],
        trustStatus: 'trusted',
        endpointStatus: 'active',
        nearbyChatrooms: ['global', 'sf'],
        isContact: true,
        expiresAt: futureExpiresAt,
      },
    });
    expect(remembered.ok()).toBeTruthy();
    const rememberedBody = await remembered.json();
    expect(rememberedBody.bootstrapCandidates).toEqual([
      expect.objectContaining({ peerId: 'pub_fast_contact', endpointHints: ['webrtc:fast-contact'] }),
    ]);

    const failed = await request.post(`${gunBaseURL()}/api/p2p/neighbors`, {
      data: {
        peerId: 'pub_failed_endpoint',
        endpointHints: ['webrtc:failed'],
        lastSeenAt: '2026-05-20T00:01:00.000Z',
        successfulSessions: 8,
        latencyMs: 1,
        transportType: 'webrtc-datachannel',
        capabilities: ['signed-discovery'],
        trustStatus: 'unknown',
        endpointStatus: 'failed',
        nearbyChatrooms: ['global'],
        isContact: false,
        expiresAt: futureExpiresAt,
      },
    });
    expect(failed.ok()).toBeTruthy();
    const failedBody = await failed.json();
    expect(failedBody.neighbors).toEqual(expect.arrayContaining([expect.objectContaining({ peerId: 'pub_failed_endpoint' })]));
    expect(failedBody.bootstrapCandidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ peerId: 'pub_failed_endpoint' })]),
    );

    const blocked = await request.post(`${gunBaseURL()}/api/p2p/neighbors/block-peer`, {
      data: { peerId: 'pub_fast_contact' },
    });
    expect(blocked.ok()).toBeTruthy();
    const blockedBody = await blocked.json();
    expect(blockedBody.blockedPeerIds).toContain('pub_fast_contact');
    expect(blockedBody.bootstrapCandidates).toEqual([]);

    const exported = await request.post(`${gunBaseURL()}/api/p2p/neighbors/export-encrypted`, {
      data: { encryptedExport: 'SEA{"ct":"neighbor-cache"}' },
    });
    expect(exported.ok()).toBeTruthy();
    expect((await exported.json()).encryptedExport).toBe('SEA{"ct":"neighbor-cache"}');

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-p2p-neighbor-memory')).toBeVisible();
    await expect(p.locator('#storage-inspector-p2p-neighbor-memory')).toContainText('local-only');
    await expect(p.locator('#storage-inspector-p2p-neighbor-controls')).toContainText('Export encrypted');
    await expect(p.locator('#storage-inspector-p2p-neighbor-controls')).toContainText('1 blocked');
    await expect(p.locator('#storage-inspector-p2p-neighbor-candidates')).toContainText('star fallback');
  });
});
