/**
 * Person-first entry (OPEN-94, docs/design/nearby-and-place-chatrooms.md "Four tabs as graph
 * views"; superseded redesign rule N2a). A chatroom member row opens the person page (the shared
 * User layout) — not the conversation; Message is an explicit action there. The back chain is
 * Conversation → User layout → opener. The Contacts-tab row lands on the same User layout, and
 * both entry points resolve to the SAME pair thread (same conv_pair conversation id).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { openCurrentChatroom } from '../../helpers/chatroom-nav';

test.describe.configure({ timeout: 120_000 });

test.describe('Person-first entry (OPEN-94)', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let contextTom: BrowserContext | undefined;
  let contextJerry: BrowserContext | undefined;
  let pageTom: Page | undefined;
  let pageJerry: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTom = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browserJerry = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
  });

  test.afterAll(async () => {
    for (const p of [pageTom, pageJerry]) {
      await p?.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await browserJerry?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  async function bootstrap(browser: Browser, stageName: string): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await openSettingsSection(page, SETTINGS_SECTION.profile);
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    await openCurrentChatroom(page);
    await afterSync();
    return { context, page };
  }

  test('member click lands on ⟨User⟩; Message opens ⟨Conv⟩; back chain pops ⟨User⟩ then opener; contact entry reaches the same thread', async () => {
    ({ context: contextTom, page: pageTom } = await bootstrap(browserTom, 'TomEntry'));
    ({ context: contextJerry, page: pageJerry } = await bootstrap(browserJerry, 'JerryEntry'));
    const tom = pageTom!;
    const jerry = pageJerry!;

    // ── Member row click (C3) ────────────────────────────────────────────────
    await tom.waitForSelector('.chatroom-member-item', { timeout: 20_000 });
    const jerryRow = tom.locator('.chatroom-member-item').filter({ hasText: 'JerryEntry' }).first();
    await expect(jerryRow).toBeVisible({ timeout: 15_000 });
    await jerryRow.click();

    // ⟨User⟩ opens; the conversation does not open by itself.
    await expect(tom.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(tom.locator('#conversation-detail-overlay')).toBeHidden();
    await expect(tom.locator('#peer-detail-name')).toContainText('JerryEntry');

    // Message is explicit: send a DM from the person page, then open its thread.
    const dmText = `entry dm ${Date.now()}`;
    await tom.locator('#peer-dm-input').fill(dmText);
    await tom.locator('#peer-dm-send-btn').click();
    await expect(tom.locator('#peer-dm-send-btn')).toContainText('Sent', { timeout: 30_000 });
    await tom.locator('[data-testid="dm-thread-entry"]').click({ timeout: 15_000 });
    await expect(tom.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(tom.locator('#conversation-user-name')).toContainText('JerryEntry');
    // The DM thread carries no talk scope.
    await expect(tom.locator('#conversation-thread-scope')).toBeHidden();
    await expect(tom.locator('#conversation-messages')).toContainText(dmText, { timeout: 20_000 });

    // ── Back chain: Conversation → User layout → opener (room detail) ──
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
      const conversations = ((window as any).__iinpublic_collection?.('myConversations') ?? {});
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

    // contacts-view.ts tap-target split: the row click lands directly on the shared
    // ⟨User⟩ layout (peer-detail), not the DM conversation — reach it via the thread row.
    await expect(jerry.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await jerry.locator('[data-testid="dm-thread-entry"]').click();
    await expect(jerry.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    // Same thread object: Tom's message is in Jerry's DM conversation.
    await expect(jerry.locator('#conversation-messages')).toContainText(dmText, { timeout: 30_000 });
    const jerryConvId = await jerry.evaluate(() => {
      const conversations = ((window as any).__iinpublic_collection?.('myConversations') ?? {});
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
