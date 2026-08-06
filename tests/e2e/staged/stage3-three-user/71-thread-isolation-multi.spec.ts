/**
 * Pair-private threads with three users (redesign §5, T8): the same matched talk
 * produces one thread per PAIR — Tom↔Jerry thread messages never appear in the
 * Tom↔Bob thread for the same talk — and per-thread unread badges appear on the
 * receiver's User layout and clear after reading.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom } from '../../helpers/ports';
import { afterLoad, afterSync, afterNav } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

test.describe.configure({ timeout: 150_000 });

const TALK_ID = 'talk-multi-thread-e2e';
const TALK_TITLE = 'Shared Interest Talk';

test.describe('Thread isolation across three users', () => {
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

  async function seedPairThread(page: Page, otherId: string, otherName: string): Promise<string> {
    return page.evaluate(async ({ otherId, otherName, talkId, talkTitle }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const me = app.currentUser;
      const conversationId = await app.conversationService.createConversation({
        userId1: me.id,
        userName1: me.stageName,
        userId2: otherId,
        userName2: otherName,
        talkId,
      });
      app.uiManager.addNewConversation({ conversationId, otherUserId: otherId, otherUserName: otherName, talkId });
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      myTalks[talkId] = { role: 'created', title: talkTitle, fullTalk: { id: talkId, title: talkTitle } };
      localStorage.setItem('myTalks', JSON.stringify(myTalks));
      return conversationId as string;
    }, { otherId, otherName, talkId: TALK_ID, talkTitle: TALK_TITLE });
  }

  /**
   * Contact-row entry lands directly on the User layout (contacts-view.ts tap-target
   * split) — no DM conversation step to back out of first.
   */
  async function openUserLayoutFor(page: Page, name: string): Promise<void> {
    await page.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    const row = page.locator('#contacts-list .contact-item').filter({ hasText: name }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
  }

  test('same talk, three users: threads stay pair-private with per-thread badges', async () => {
    const [tom, jerry, bob] = await Promise.all([
      bootstrap('TomMulti'),
      bootstrap('JerryMulti'),
      bootstrap('BobMulti'),
    ]);

    const [tomId, jerryId, bobId] = await Promise.all(
      [tom, jerry, bob].map((p) => p.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id)),
    );

    // Same talk id in both pairs — isolation must come from the pair, not the talk.
    const tomJerryConv = await seedPairThread(tom, jerryId, 'JerryMulti');
    await seedPairThread(jerry, tomId, 'TomMulti');
    const tomBobConv = await seedPairThread(tom, bobId, 'BobMulti');
    await seedPairThread(bob, tomId, 'TomMulti');
    expect(tomJerryConv).not.toBe(tomBobConv);

    // Jerry parks on Tom's User layout.
    await openUserLayoutFor(jerry, 'TomMulti');

    // Tom writes into the Tom↔Jerry thread for the shared talk.
    await openUserLayoutFor(tom, 'JerryMulti');
    const jerryThreadMsg = `only for jerry ${Date.now()}`;
    await tom.locator('[data-testid="matched-talk-thread"]').first().click();
    await expect(tom.locator('#conversation-thread-scope')).toContainText(TALK_TITLE);
    await tom.locator('#conversation-message-input').fill(jerryThreadMsg);
    await tom.locator('#send-conversation-message').click();
    await expect(tom.locator('#conversation-messages')).toContainText(jerryThreadMsg, { timeout: 20_000 });
    await tom.click('#back-from-conversation');

    // Jerry's open User layout gains a per-thread unread badge for that talk row.
    const jerryThreadRow = jerry.locator('[data-testid="matched-talk-thread"]').first();
    await expect(jerryThreadRow.locator('.thread-unread-badge')).toBeVisible({ timeout: 30_000 });

    // Reading the thread clears the badge and shows the message.
    await jerryThreadRow.click();
    await expect(jerry.locator('#conversation-messages')).toContainText(jerryThreadMsg, { timeout: 30_000 });
    await jerry.click('#back-from-conversation');
    await expect(jerry.locator('[data-testid="matched-talk-thread"]').first().locator('.thread-unread-badge')).toBeHidden({ timeout: 15_000 });

    // Bob's thread for the SAME talk with Tom is a different pair thread: empty of Jerry's message.
    await openUserLayoutFor(bob, 'TomMulti');
    const bobThreadRow = bob.locator('[data-testid="matched-talk-thread"]').first();
    await expect(bobThreadRow).toContainText(TALK_TITLE);
    await expect(bobThreadRow.locator('.thread-unread-badge')).toBeHidden();
    await bobThreadRow.click();
    await expect(bob.locator('#conversation-thread-scope')).toContainText(TALK_TITLE);
    await expect(bob.locator('#conversation-messages')).not.toContainText(jerryThreadMsg);
  });
});
