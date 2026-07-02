/**
 * Blocklist persistence across browser restart.
 * Bootstrap two users: Alice blocks Bobby.
 * Reload Alice's page (restart her context with same IndexedDB/localStorage).
 * Verify Bobby is still shown as blocked in Alice's UI.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterLoad, afterSync, headless, E2E_ASSERT_TIMEOUT_MS } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { gunBaseURL } from '../../helpers/ports';

test.describe('Blocklist persists after browser restart', () => {
  let browserAlice: Browser;
  let browserBob: Browser;
  let contextAlice: BrowserContext;
  let contextBob: BrowserContext;
  let pageAlice: Page;
  let pageBob: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({
      headless,
      args: ['--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      args: ['--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await pageAlice?.close().catch(() => {});
    await pageBob?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await browserBob?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('blocklist persists across browser restart', async () => {
    // Bootstrap both users
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;

    const bob = await bootstrapUser(browserBob, 'Bobby', 'Bobby');
    contextBob = bob.context;
    pageBob = bob.page;

    // Both enter Global chatroom to establish some connection context
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    // Get user IDs for verification
    const aliceUserId = await pageAlice.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    const bobbyUserId = await pageBob.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );

    // Block Bobby through the client service — the exact code path the UI block
    // button uses (app.ts 'blockUser' handler → WebUserService.blockUser), which
    // updates the server block graph AND Alice's SEA-encrypted private blockedUserIds.
    const blockedAfterCall = await pageAlice.evaluate(async (targetId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      return await app.userService.blockUser(app.currentUser.id, targetId);
    }, bobbyUserId);
    expect(blockedAfterCall).toContain(bobbyUserId);
    await afterSync();

    // Verify Bobby is blocked by checking the API
    await expect
      .poll(
        async () => {
          const res = await pageAlice.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(aliceUserId)}/blocks`,
          );
          if (!res.ok()) return [];
          return (await res.json() as { blockedUserIds: string[] }).blockedUserIds;
        },
        { timeout: E2E_ASSERT_TIMEOUT_MS },
      )
      .toContain(bobbyUserId);

    // === RESTART Alice's browser with page reload ===
    // Simply reload the page to simulate a browser restart while preserving storage
    await pageAlice.reload({ waitUntil: 'domcontentloaded' });
    await afterLoad();

    // Verify Alice is still logged in with her stageName
    const headerText = await pageAlice.locator('[data-testid="user-stage-name"]').textContent({ timeout: 10000 });
    expect(headerText).toContain('Alice');

    // HARD assertion: after restart, Alice's client-side private blockedUserIds
    // must contain Bobby again (reloaded from encrypted private data — the server
    // cannot supply this list, so this proves client persistence).
    await expect
      .poll(
        async () =>
          await pageAlice.evaluate(
            () => (window as any).__iinpublic_app?.getApp()?.currentUser?.blockedUserIds || [],
          ),
        { timeout: E2E_ASSERT_TIMEOUT_MS },
      )
      .toContain(bobbyUserId);

    // And the server block graph still has the edge (delivery suppression source).
    const finalBlocks = await pageAlice.request.get(
      `${gunBaseURL()}/api/users/${encodeURIComponent(aliceUserId)}/blocks`,
    );
    expect(finalBlocks.ok()).toBeTruthy();
    const blockedList = (await finalBlocks.json()) as { blockedUserIds: string[] };
    expect(blockedList.blockedUserIds).toContain(bobbyUserId);

    await pageAlice.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
