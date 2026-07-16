/**
 * Notification auto-dismiss (redesign §4, T4): every toast type auto-dismisses on
 * time (3s; Match! 8s), the Match! marker attribute is preserved, and clicking a
 * Match! toast dismisses it and navigates to its conversation (rule N6).
 */
import { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('Notification auto-dismiss', () => {
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

  test('all ordinary toast types dismiss within ~3s', async () => {
    const p = page!;
    for (const type of ['success', 'error', 'info', 'warning'] as const) {
      const text = `autodismiss ${type} toast`;
      await p.evaluate(
        ([msg, kind]) => (window as any).__iinpublic_app.getApp().uiManager.showNotification(msg, kind),
        [text, type],
      );
      const toast = p.locator('.notification', { hasText: text });
      await expect(toast).toBeVisible();
      // Gone within the 3s timeout (+ slack).
      await expect(toast).toHaveCount(0, { timeout: 6_000 });
    }
  });

  test('Match! toast keeps its marker, lingers 8s, then dismisses on its own', async () => {
    const p = page!;
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app.getApp().uiManager;
      ui.showNotification(ui.formatTalkMatched('Peer', 'Autodismiss Talk'), 'success');
    });
    const toast = p.locator('.notification[data-match-notification="true"]', { hasText: 'Autodismiss Talk' });
    await expect(toast).toBeVisible();
    // Still visible after the ordinary 3s window (it gets the longer 8s timeout)…
    await p.waitForTimeout(4_000);
    await expect(toast).toBeVisible();
    // …but no longer persistent: gone within the 8s timeout (+ slack).
    await expect(toast).toHaveCount(0, { timeout: 8_000 });
  });

  test('clicking a Match! toast dismisses it and opens its conversation', async () => {
    const p = page!;
    await p.evaluate(() => {
      const ui = (window as any).__iinpublic_app.getApp().uiManager;
      ui.addNewConversation({
        conversationId: 'conv-autodismiss-e2e',
        otherUserId: 'peer-autodismiss',
        otherUserName: 'Toast Peer',
        talkId: 'talk-autodismiss',
      });
      ui.showNotification(ui.formatTalkMatched('Toast Peer', 'Click Nav Talk'), 'success', {
        conversationId: 'conv-autodismiss-e2e',
      });
    });
    const toast = p.locator('.notification[data-match-notification="true"]', { hasText: 'Click Nav Talk' });
    await expect(toast).toBeVisible();
    await toast.click();
    await expect(toast).toHaveCount(0);
    // Rule N6: the click navigated to the match's conversation.
    await expect(p.locator('#conversation-detail-overlay')).toBeVisible();
    await expect(p.locator('#conversation-user-name')).toContainText('Toast Peer');
  });

  test('ordinary toast click dismisses without navigation', async () => {
    const p = page!;
    await p.evaluate(() => (window as any).__iinpublic_app.getApp().uiManager.showNotification('plain toast', 'info'));
    const toast = p.locator('.notification', { hasText: 'plain toast' });
    await expect(toast).toBeVisible();
    await toast.click();
    await expect(toast).toHaveCount(0);
    await expect(p.locator('#conversation-detail-overlay')).toBeHidden();
  });
});
