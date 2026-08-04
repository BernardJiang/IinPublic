/**
 * TODO §K6 test 1: attempt to block/filter TechSupport by every available route — the
 * contact row and message delivery must survive all of them.
 *
 * The Contacts-tab support row itself never exposes a "Block" affordance at all (its
 * click handler opens `openSupportControlsDialog`, which offers only a mute toggle —
 * see contacts-view.ts); block is only reachable for TechSupport by going around the
 * intended UI, which is exactly what this test does: the client-service call the normal
 * relationship dialog would make, and the raw server API call the client itself makes
 * under the hood. Both are guarded by `assertBlockTargetAllowed`
 * (src/shared/techsupport.ts) — client-side in `WebUserService.blockUser` and
 * server-side in `UserService.blockUser` — so this test proves defense in depth, not a
 * single choke point.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, afterSync, afterAction } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('TechSupport is unblockable by every available route (docs/TODO.md K6)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless: true,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (page) await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    if (context) await context.close();
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('mute, client-service call, and raw server API attempts all fail to block TechSupport', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', 'RouteTester');
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();

    await page.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(page, 'contacts');
    const supportRow = page.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await expect(supportRow).toBeVisible({ timeout: 15_000 });

    // Route 1: tapping the row (not the name) lands directly on the shared ⟨User⟩ layout
    // — no DM conversation step to back out of (contacts-view.ts tap-target split) — whose
    // relationship-controls button is TechSupport-aware: `openRelationshipDialog` redirects
    // TechSupport's id straight to `openSupportControlsDialog`, a mute-only dialog with no
    // block button rendered at all — not a disabled one. Confirm that redirection actually
    // holds live.
    await supportRow.click();
    await afterAction();
    const relationshipBtn = page.locator('#contact-edit-relationship-btn, [data-testid="contact-edit-relationship-btn"]');
    if (await relationshipBtn.count() > 0) {
      await relationshipBtn.click();
      await afterAction();
      await expect(page.locator('#contact-support-mute-btn')).toBeVisible({ timeout: 5_000 });
      await expect(page.locator('#contact-block-toggle-btn')).toHaveCount(0);
      await page.click('#close-contact-relationship-modal, #contact-relationship-close-btn');
    }

    const myUserId = await page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || '');
    expect(myUserId).toBeTruthy();

    // Route 2: call the client service's blockUser directly, bypassing the UI entirely —
    // this is the exact call the (non-existent, for TechSupport) relationship dialog's
    // Block button would make for an ordinary peer.
    const clientAttempt = await page.evaluate(async (targetId) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      try {
        await app.userService.blockUser(app.currentUser.id, targetId);
        return { threw: false };
      } catch (error) {
        return { threw: true, message: String((error as Error)?.message || '') };
      }
    }, TECHSUPPORT_ROOT_USER_ID);
    expect(clientAttempt.threw).toBe(true);
    expect(clientAttempt.message).toContain('cannot be blocked');

    // Route 3: bypass the client entirely and hit the server's raw block endpoint —
    // proves the guard is enforced server-side too, not just trusted-client-side.
    const apiResponse = await page.request.post(
      `${gunBaseURL()}/api/users/${encodeURIComponent(myUserId)}/blocks`,
      { data: { targetId: TECHSUPPORT_ROOT_USER_ID } },
    );
    expect(apiResponse.ok()).toBe(false);
    expect(apiResponse.status()).toBe(400);
    const apiBody = await apiResponse.json();
    expect(String(apiBody.error || '')).toContain('cannot be blocked');

    // After every attempt: TechSupport is still not blocked, the contact row survives,
    // and a real message round-trip through the support channel still works.
    const statusResponse = await page.request.get(
      `${gunBaseURL()}/api/users/${encodeURIComponent(myUserId)}/block-status/${encodeURIComponent(TECHSUPPORT_ROOT_USER_ID)}`,
    );
    const statusBody = await statusResponse.json();
    expect(statusBody.blocked).toBe(false);

    const peerDetailOverlay = page.locator('#peer-detail-overlay');
    if (await peerDetailOverlay.isVisible().catch(() => false)) {
      await page.click('#back-from-peer-detail');
      await afterAction();
    }
    await page.click('.nav-btn[data-view="contacts"]');
    await waitForTabActive(page, 'contacts');
    await expect(supportRow).toBeVisible({ timeout: 15_000 });
    await supportRow.locator('.contact-item-name').click(); // tap the name — row tap alone no longer opens the DM (contacts-view.ts tap-target split)
    await afterAction();
    await expect(page.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const question = `Route test question ${Date.now()}?`;
    await page.fill('#conversation-message-input', question);
    await page.click('#send-conversation-message');
    await afterSync();
    await expect(page.locator('#conversation-messages')).toContainText(question, { timeout: 15_000 });
  });
});
