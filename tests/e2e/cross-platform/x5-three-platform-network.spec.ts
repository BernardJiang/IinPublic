/**
 * X5 (nightly) — three-platform stage-3 network incl. thread isolation.
 *
 * Standing in for a real three-platform network the same way X1/X2/X4/X6 do
 * (browser context = platform): three independently-launched Chromium browsers
 * on the shared per-worker hub, named Website/Webapp/Native. Ports
 * `staged/stage3-three-user/71-thread-isolation-multi` — which already proves
 * this exact scenario (same talk, three users, pair-private threads, per-thread
 * unread badges) with three simultaneous browsers and no native app involved —
 * into the cross-platform harness with one client per named platform.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../helpers/clear-database';
import { clearGunForStage2Spec } from '../helpers/e2e-stage-pipeline';
import { webAppURLStableChatroom } from '../helpers/ports';
import { headless, afterLoad, afterSync, afterNav, E2E_ASSERT_TIMEOUT_MS } from '../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../helpers/webrtc-chromium';
import { openSettingsSection, SETTINGS_SECTION } from '../helpers/settings-nav';

const TALK_ID = 'talk-x5-cross-platform-thread-e2e';
const TALK_TITLE = 'X5 Shared Interest Talk';

test.describe('X5: three-platform network + thread isolation', () => {
  test.setTimeout(150_000);

  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    for (const p of pages) {
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await clearGunForStage2Spec();
  });

  async function bootstrapPlatformClient(stageName: string, x: number): Promise<Page> {
    const browser = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,1100'],
    });
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
    await expect(row).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
    await row.click();
    await expect(page.locator('#peer-detail-overlay')).toBeVisible({ timeout: E2E_ASSERT_TIMEOUT_MS });
  }

  test('3 clients; pair-private threads stay isolated across platforms', async () => {
    const [website, webapp, native] = await Promise.all([
      bootstrapPlatformClient('X5-Website', 0),
      bootstrapPlatformClient('X5-Webapp', 660),
      bootstrapPlatformClient('X5-Native', 1320),
    ]);

    const [websiteId, webappId, nativeId] = await Promise.all(
      [website, webapp, native].map((p) => p.evaluate(() => (window as any).__iinpublic_app.getApp().currentUser.id)),
    );

    // Same talk id in both pairs — isolation must come from the pair, not the talk.
    const websiteWebappConv = await seedPairThread(website, webappId, 'X5-Webapp');
    await seedPairThread(webapp, websiteId, 'X5-Website');
    const websiteNativeConv = await seedPairThread(website, nativeId, 'X5-Native');
    await seedPairThread(native, websiteId, 'X5-Website');
    expect(websiteWebappConv).not.toBe(websiteNativeConv);

    // Webapp parks on Website's User layout.
    await openUserLayoutFor(webapp, 'X5-Website');

    // Website writes into the Website<->Webapp thread for the shared talk.
    await openUserLayoutFor(website, 'X5-Webapp');
    const webappThreadMsg = `only for webapp ${Date.now()}`;
    await website.locator('[data-testid="matched-talk-thread"]').first().click();
    await expect(website.locator('#conversation-thread-scope')).toContainText(TALK_TITLE);
    await website.locator('#conversation-message-input').fill(webappThreadMsg);
    await website.locator('#send-conversation-message').click();
    await expect(website.locator('#conversation-messages')).toContainText(webappThreadMsg, { timeout: E2E_ASSERT_TIMEOUT_MS });
    await website.click('#back-from-conversation');

    // Webapp's open User layout gains a per-thread unread badge for that talk row. Cross-user
    // sync (webapp's device picking up website's write), so gets extra headroom beyond the base
    // per-worker-count budget on top of the load-aware floor.
    const webappThreadRow = webapp.locator('[data-testid="matched-talk-thread"]').first();
    await expect(webappThreadRow.locator('.thread-unread-badge')).toBeVisible({
      timeout: Math.max(30_000, E2E_ASSERT_TIMEOUT_MS),
    });

    // Reading the thread clears the badge and shows the message.
    await webappThreadRow.click();
    await expect(webapp.locator('#conversation-messages')).toContainText(webappThreadMsg, {
      timeout: Math.max(30_000, E2E_ASSERT_TIMEOUT_MS),
    });
    await webapp.click('#back-from-conversation');
    await expect(
      webapp.locator('[data-testid="matched-talk-thread"]').first().locator('.thread-unread-badge'),
    ).toBeHidden({ timeout: E2E_ASSERT_TIMEOUT_MS });

    // Native's thread for the SAME talk with Website is a different pair thread: empty of webapp's message.
    await openUserLayoutFor(native, 'X5-Website');
    const nativeThreadRow = native.locator('[data-testid="matched-talk-thread"]').first();
    await expect(nativeThreadRow).toContainText(TALK_TITLE);
    await expect(nativeThreadRow.locator('.thread-unread-badge')).toBeHidden();
    await nativeThreadRow.click();
    await expect(native.locator('#conversation-thread-scope')).toContainText(TALK_TITLE);
    await expect(native.locator('#conversation-messages')).not.toContainText(webappThreadMsg);
  });
});
