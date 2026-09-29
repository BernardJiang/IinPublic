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
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

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
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
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

    // Verify Bobby is blocked by checking the API. No GET /blocks enumeration endpoint
    // (block-pairs storage is deliberately non-enumerable, see src/shared/block-pair.ts) —
    // poll the specific-pair block-status check instead.
    await expect
      .poll(
        async () => {
          const res = await pageAlice.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(aliceUserId)}/block-status/${encodeURIComponent(bobbyUserId)}`,
          );
          if (!res.ok()) return false;
          return Boolean(((await res.json()) as { blocked?: boolean }).blocked);
        },
        { timeout: E2E_ASSERT_TIMEOUT_MS },
      )
      .toBe(true);

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

    // And the server block-pairs graph still has the relationship (delivery suppression source).
    const finalBlockStatus = await pageAlice.request.get(
      `${gunBaseURL()}/api/users/${encodeURIComponent(aliceUserId)}/block-status/${encodeURIComponent(bobbyUserId)}`,
    );
    expect(finalBlockStatus.ok()).toBeTruthy();
    const blockStatus = (await finalBlockStatus.json()) as { blocked: boolean };
    expect(blockStatus.blocked).toBe(true);

    await pageAlice.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
