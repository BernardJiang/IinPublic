/**
 * Conversation-first entry (redesign §5/§7 rule N2a, T8):
 * clicking a user anywhere (chatroom member row, contact row) opens the default
 * DM Conversation directly with the shared User layout underneath; the back chain
 * is Conversation → User layout → opener; both entry points land on the SAME
 * pair thread (same conv_pair conversation id).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases, injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';

test.describe.configure({ timeout: 120_000 });

test.describe('Conversation-first entry (N2a)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await maybeClearGunDatabases();
    browserTom = await chromium.launch();
    browserJerry = await chromium.launch();
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await maybeClearGunDatabases();
  });

  async function bootstrap(browser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
    return { context, page };
  }

  test('member click lands on ⟨Conv⟩; back chain pops ⟨User⟩ then opener; contact entry joins the same thread', async () => {
    ({ context: contextTom, page: pageTom } = await bootstrap(browserTom, 'TomEntry'));
    ({ context: contextJerry, page: pageJerry } = await bootstrap(browserJerry, 'JerryEntry'));
    const tom = pageTom!;
    const jerry = pageJerry!;

    // ── Member row click (C3) ────────────────────────────────────────────────
    await tom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
    const jerryRow = tom.locator('.chatroom-member-item').filter({ hasText: 'JerryEntry' }).first();
    await expect(jerryRow).toBeVisible({ timeout: 15_000 });
    await jerryRow.click();

    // ⟨Conv⟩ opens directly, ⟨User⟩ layout sits underneath (two levels pushed at once).
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible();
    await expect(tom.locator('#conversation-user-name')).toContainText('JerryEntry');
    // The DM thread carries no talk scope.
    await expect(tom.locator('#conversation-thread-scope')).toBeHidden();

    // Send a DM so the pair conversation exists on both sides.
    const dmText = `entry dm ${Date.now()}`;
    await tom.locator('#conversation-message-input').fill(dmText);
    await tom.locator('#send-conversation-message').click();
    await expect(tom.locator('#conversation-messages')).toContainText(dmText, { timeout: 20_000 });

    // ── Back chain (N2a): Conversation → User layout → opener (room detail) ──
    await tom.click('#back-from-conversation');
    await expect(tom.locator('#conversation-detail-overlay')).toBeHidden();
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible();
    await expect(tom.locator('#peer-detail-name')).toContainText('JerryEntry');
    // The messaging area lists the DM thread with the sent snippet.
    await expect(tom.locator('[data-testid="dm-thread-entry"]')).toBeVisible();

    await tom.click('#back-from-peer-detail');
    await expect(tom.locator('#peer-detail-overlay')).toBeHidden();
    await expect(tom.locator('#chatroom-detail-container')).toBeVisible();

    const tomConvId = await tom.evaluate(() => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      return Object.keys(conversations).find((id) => id.startsWith('conv_pair_')) || '';
    });
    expect(tomConvId).toMatch(/^conv_pair_/);

    // ── Contact row click (K1) on Jerry's side joins the SAME thread ─────────
    await jerry.click('.nav-btn[data-view="me"]');
    await afterSync();
    await jerry.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const tomContact = jerry.locator('#contacts-list .contact-item').filter({ hasText: 'TomEntry' }).first();
    await expect(tomContact).toBeVisible({ timeout: 30_000 });
    await tomContact.click();

    // Direct to ⟨Conv⟩ with ⟨User⟩ underneath — identical destination to C3.
    await expect(jerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(jerry.locator('#peer-detail-overlay')).toBeVisible();
    // Same thread object: Tom's message is in Jerry's DM conversation.
    await expect(jerry.locator('#conversation-messages')).toContainText(dmText, { timeout: 30_000 });
    const jerryConvId = await jerry.evaluate(() => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
      return Object.keys(conversations).find((id) => id.startsWith('conv_pair_')) || '';
    });
    expect(jerryConvId).toBe(tomConvId);

    // Back chain on the contacts side: Conversation → User layout → Contacts list.
    await jerry.click('#back-from-conversation');
    await expect(jerry.locator('#peer-detail-overlay')).toBeVisible();
    await jerry.click('#back-from-peer-detail');
    await expect(jerry.locator('#peer-detail-overlay')).toBeHidden();
    await expect(jerry.locator('#contacts-list-container')).toBeVisible();
  });
});
