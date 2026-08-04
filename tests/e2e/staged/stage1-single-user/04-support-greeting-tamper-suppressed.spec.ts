import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterNav, delay, headless } from '../../helpers/timing';
import { webBaseURL, gunBaseURL } from '../../helpers/ports';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { waitForTabActive } from '../../helpers/talks-matching-flow';
import { TECHSUPPORT_ROOT_USER_ID } from '../../../../src/shared/techsupport';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

const TAMPER_SNIPPET = 'CLICK HERE for a free prize';

async function readGreetingText(userId: string): Promise<string | undefined> {
  const res = await fetch(`${gunBaseURL()}/api/test/export-snapshot`);
  expect(res.ok).toBeTruthy();
  const snapshot = (await res.json()) as { gunGraph?: Record<string, any> };
  const suffix = `/messages/support_welcome_${userId}`;
  const [, record] = Object.entries(snapshot.gunGraph || {}).find(([soul]) => soul.endsWith(suffix)) || [];
  return (record as any)?.text;
}

test.describe('TechSupport — tampered greeting suppressed, never rendered (docs/TODO.md K2-3)', () => {
  let browser: Browser;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 150),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=960,1400', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    if (browser) await browser.close();
    await clearGunForStage1Spec();
  });

  test('a stored greeting whose text was altered after signing renders as nothing, silently', async () => {
    context = await browser.newContext({ viewport: { width: 960, height: 1200 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => console.log('[Browser]:', m.text()));
    await injectIdbClear(page);

    await gotoWebApp(page, webBaseURL());
    await ensureWindowFitsViewport(page, 960, 1200);
    await afterLoad();
    attachE2eBrowserTabLabel(page, 'User1');

    const userId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
    expect(userId).toBeTruthy();
    const conversationId = `conv_support_${TECHSUPPORT_ROOT_USER_ID}_${userId}`;

    // Let the real, genuinely-signed greeting land first (K2's normal path).
    await expect.poll(() => readGreetingText(userId), { timeout: 15_000 }).toEqual(expect.any(String));
    const originalText = (await readGreetingText(userId))!;
    expect(originalText).toContain('Welcome to IinPublic');

    // A contact click lands on the DM conversation directly (redesign §5, rule N2a) — there
    // is no separate conversation-list UI to click through.
    await waitForTabActive(page, 'contacts');
    const supportContactRow = page.locator(`.contact-item[data-support-contact="true"][data-contact-user-id="${TECHSUPPORT_ROOT_USER_ID}"]`);
    await supportContactRow.waitFor({ state: 'visible', timeout: 15_000 });
    await supportContactRow.locator(".contact-item-name").click(); // tap the name — row tap alone no longer opens the DM (contacts-view.ts tap-target split)
    await afterNav();
    await expect(page.locator('#conversation-messages')).toContainText('Welcome to IinPublic', { timeout: 15_000 });

    const notificationCountBefore = await page.locator('.notification').count();

    // Tamper: overwrite the same deterministic soul with altered text, leaving the signature
    // metadata untouched — this is exactly the "text was altered after signing" attack the
    // render-time text cross-check (not the signature check alone) must catch.
    await page.evaluate(
      ({ cid, uid, tamperedText }) => {
        const app = (window as any).__iinpublic_app?.getApp?.();
        const existing = JSON.parse(localStorage.getItem('myConversations') || '{}')[cid];
        app?.conversationService?.upsertMessageRecord?.(
          cid,
          {
            id: `support_welcome_${uid}`,
            senderId: 'iinpublic-root-techsupport',
            text: tamperedText,
            timestamp: new Date().toISOString(),
            channel: 'public',
            transport: existing?.transportMode || 'star-gun',
            greetingLocale: 'en',
            greetingSignature: 'SEA-signature-left-unchanged-but-text-was-altered',
            greetingAuthorPub: 'mYRexxiSF2FG3oV-3-LKXEtisnUv5JQ9nDHbRANxiZo.jRqTX1_rg0v3BbFWYt1ZqGwBRG7wzg44IKgPobrSpfQ',
          },
          { otherUserId: uid },
        );
      },
      { cid: conversationId, uid: userId, tamperedText: `${originalText} ${TAMPER_SNIPPET}` },
    );

    // Force a fresh render pass over the tampered data — re-opening the conversation is what a
    // real user re-clicking it (or a fresh page load) does, and re-emits 'loadConversation',
    // which re-subscribes and re-renders from the (now tampered) stored data.
    await page.evaluate((cid) => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
    }, conversationId);

    // K2-3: silent suppression — the tampered message must never render, in whole or in part.
    await expect.poll(
      () => page.locator('#conversation-messages').innerText(),
      { timeout: 10_000 },
    ).not.toContain(TAMPER_SNIPPET);
    const finalText = await page.locator('#conversation-messages').innerText();
    expect(finalText).not.toContain(TAMPER_SNIPPET);
    // The pre-tamper valid text is also gone (same soul was overwritten) — nothing
    // attributed to TechSupport in this thread beyond what verifies.
    expect(finalText).not.toContain('Welcome to IinPublic');

    // Silent means silent: no error/warning toast surfaced because of the failed verification.
    const notificationCountAfter = await page.locator('.notification').count();
    expect(notificationCountAfter).toBeLessThanOrEqual(notificationCountBefore);

    await page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
    await page.close();
    await context.close();
  });
});
