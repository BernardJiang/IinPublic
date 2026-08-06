/**
 * TODO §N2 (stage3 follow-up): Tom and Jerry both DM Bob while Bob is on a
 * non-Contacts tab. The cross-tab #dm-inbox-btn affordance must list both senders
 * sorted most-recent-first, and picking one must leave the other sender's unread
 * state untouched.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav, afterAction } from '../../helpers/timing';
import { sendConversationMessage } from '../../helpers/fast-dm-setup';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe.configure({ timeout: 150_000 });

test.describe('Cross-tab DM inbox affordance, multiple senders (N2 stage3)', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
  });

  test.afterAll(async () => {
    for (const p of pages) {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await clearGunForStage3Spec();
  });

  async function bootstrap(stageName: string): Promise<Page> {
    const browser = await chromium.launch({ args: WEBRTC_CHROMIUM_ARGS });
    browsers.push(browser);
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
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
    await page.click('.chatroom-item:has-text("Global")');
    await afterSync();
    return page;
  }

  /**
   * Creates (or reuses) the deterministic pair conversation and seeds this page's
   * own local `myConversations` entry for it — mirrors
   * `71-thread-isolation-multi.spec.ts`'s `seedPairThread`, but with `talkId:
   * 'direct'` since the DM-inbox picker reads plain DM state, not a talk thread.
   */
  async function seedDirectConversation(page: Page, otherId: string, otherName: string): Promise<string> {
    return page.evaluate(async ({ otherId, otherName }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const me = app.currentUser;
      const conversationId = await app.conversationService.createConversation({
        userId1: me.id,
        userName1: me.stageName,
        userId2: otherId,
        userName2: otherName,
        talkId: 'direct',
      });
      app.uiManager.addNewConversation({ conversationId, otherUserId: otherId, otherUserName: otherName });
      return conversationId as string;
    }, { otherId, otherName });
  }

  test('two senders, sorted most-recent-first; picking one leaves the other unread', async () => {
    const [tom, jerry, bob] = await Promise.all([
      bootstrap('InboxTom3'),
      bootstrap('InboxJerry3'),
      bootstrap('InboxBob3'),
    ]);

    const [tomId, jerryId, bobId] = await Promise.all(
      [tom, jerry, bob].map((p) => p.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id)),
    );

    const tomBobConv = await seedDirectConversation(tom, bobId, 'InboxBob3');
    await seedDirectConversation(bob, tomId, 'InboxTom3');
    const jerryBobConv = await seedDirectConversation(jerry, bobId, 'InboxBob3');
    await seedDirectConversation(bob, jerryId, 'InboxJerry3');
    expect(tomBobConv).not.toBe(jerryBobConv);

    // Establish Bob's message subscription for both conversations (opening the
    // overlay is what wires up subscribeToMessages — see conversation-e2e.ts),
    // then back out to a non-Contacts tab before either sender writes anything.
    await bob.evaluate((cid) => (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(cid), tomBobConv);
    await expect(bob.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await bob.click('#back-from-conversation');
    await bob.evaluate((cid) => (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(cid), jerryBobConv);
    await expect(bob.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await bob.click('#back-from-conversation');
    await bob.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await expect(bob.locator('.nav-btn[data-view="settings"]')).toHaveClass(/active/);

    // Tom writes first, Jerry second — Jerry must sort ahead as most-recent.
    await sendConversationMessage(tom, tomBobConv, tomId, 'Hello Bob, this is Tom');
    await expect
      .poll(async () => bob.evaluate((cid) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return conversations[cid]?.unread === true;
      }, tomBobConv), { timeout: 20_000 })
      .toBe(true);

    await sendConversationMessage(jerry, jerryBobConv, jerryId, 'Hello Bob, this is Jerry');
    await expect
      .poll(async () => bob.evaluate((cid) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return conversations[cid]?.unread === true;
      }, jerryBobConv), { timeout: 20_000 })
      .toBe(true);

    // Still on Settings — the affordance must be reachable from any tab.
    await expect(bob.locator('.nav-btn[data-view="settings"]')).toHaveClass(/active/);
    const badge = bob.locator('#dm-inbox-btn .notification-badge');
    await expect(badge).toBeVisible({ timeout: 15_000 });

    await bob.click('#dm-inbox-btn');
    const modal = bob.locator('#dm-inbox-modal');
    await expect(modal).toBeVisible({ timeout: 10_000 });
    const rows = modal.locator('.dm-inbox-row');
    await expect(rows).toHaveCount(2);
    // Most-recent-first: Jerry's message landed after Tom's.
    await expect(rows.nth(0)).toHaveAttribute('data-user-id', jerryId);
    await expect(rows.nth(1)).toHaveAttribute('data-user-id', tomId);

    await rows.nth(0).click();
    await afterAction();

    await expect(bob.locator('#dm-inbox-modal')).toHaveCount(0);
    await expect(bob.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 10_000 });
    const openedConversationId = await bob.evaluate(
      () => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.currentConversationId || '',
    );
    expect(openedConversationId).toBe(jerryBobConv);

    // Jerry's unread state is now cleared; Tom's is untouched.
    const [jerryUnread, tomUnread] = await bob.evaluate(
      ({ jerryBobConv, tomBobConv }) => {
        const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
        return [conversations[jerryBobConv]?.unread === true, conversations[tomBobConv]?.unread === true];
      },
      { jerryBobConv, tomBobConv },
    );
    expect(jerryUnread).toBe(false);
    expect(tomUnread).toBe(true);
  });
});
