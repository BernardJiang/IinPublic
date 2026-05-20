import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterNav, afterSync } from '../../helpers/timing';
import { gunBaseURL, webBaseURL } from '../../helpers/ports';

test.describe('P2P roadmap P7 — data ownership and migration', () => {
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext();
    page = await context.newPage();
    await injectIdbClear(page);
    await page.goto(webBaseURL());
    await page.waitForLoadState('load');
    await afterSync();
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('data ownership endpoints expose delete/request, migration, relay TTLs, and diagnostics', async ({ request }) => {
    const ownership = await request.get(`${gunBaseURL()}/api/p2p/data-ownership`);
    expect(ownership.ok()).toBeTruthy();
    const initial = await ownership.json();
    expect(initial.policy.deviceLocalDelete.label).toBe("Delete this device's local data");
    expect(initial.policy.serverHeldDataRequest.label).toBe('Request/delete server-held data');
    expect(initial.relayTtlPolicy).toEqual(
      expect.objectContaining({
        discovery: expect.objectContaining({ ttlSeconds: 60 }),
        signaling: expect.objectContaining({ ttlSeconds: 120 }),
        presence: expect.objectContaining({ ttlSeconds: 45 }),
        'room-membership': expect.objectContaining({ ttlSeconds: 180 }),
      }),
    );

    const deleted = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/delete-device-local`, { data: {} });
    expect(deleted.ok()).toBeTruthy();
    expect((await deleted.json()).localDeletion.clearedDataClasses).toEqual(
      expect.arrayContaining(['neighbor-cache', 'message-history', 'talks']),
    );

    const serverRequest = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/request-server-data`, {
      data: {
        requestType: 'delete-server-held-data',
        userPub: 'pub_owner',
      },
    });
    expect(serverRequest.ok()).toBeTruthy();
    expect((await serverRequest.json()).request).toEqual(
      expect.objectContaining({
        requestType: 'delete-server-held-data',
        relayVisibility: 'metadata-only',
      }),
    );

    const migration = await request.post(`${gunBaseURL()}/api/p2p/data-ownership/migrate`, {
      data: {
        paths: [
          { path: 'users/{userId}/profile', category: 'encrypted-user-owned' },
          { path: 'chatrooms/{chatroomId}', category: 'durable-public' },
        ],
      },
    });
    expect(migration.ok()).toBeTruthy();
    expect((await migration.json()).migrationPlan.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'users/{userId}/profile', action: 'move-to-local-encrypted' }),
        expect.objectContaining({ path: 'chatrooms/{chatroomId}', action: 'leave-on-relay' }),
      ]),
    );

    const diagnostic = await request.post(`${gunBaseURL()}/api/p2p/transport-diagnostics`, {
      data: {
        mode: 'server-relay',
        fallbackReason: 'direct peer unavailable',
      },
    });
    expect(diagnostic.ok()).toBeTruthy();
    expect((await diagnostic.json()).event).toEqual(
      expect.objectContaining({
        mode: 'server-relay',
        storedTelemetry: false,
        visibleToUser: true,
      }),
    );

    const p = page!;
    await p.locator('.nav-btn[data-view="settings"]').click();
    await afterNav();
    await expect(p.locator('#storage-inspector-data-ownership')).toBeVisible();
    await expect(p.locator('#storage-inspector-data-ownership')).toContainText("Delete this device's local data");
    await expect(p.locator('#storage-inspector-data-ownership-server')).toContainText('delete-server-held-data');
    await expect(p.locator('#storage-inspector-data-ownership-migration')).toContainText('Move eligible');
    await expect(p.locator('#storage-inspector-relay-ttl-policy')).toContainText('presence');
    await expect(p.locator('#storage-inspector-transport-diagnostics')).toContainText('local-visible');
  });
});
