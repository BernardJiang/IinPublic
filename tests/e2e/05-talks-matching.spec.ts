import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay } from './helpers/timing';

test.describe('Talks: matching, status, chatbot, change answer', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let contextBob: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;
  let pageBob: Page;

  test.beforeAll(async () => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless: false,
      slowMo: delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless: false,
      slowMo: delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless: false,
      slowMo: delay(50, 120),
      args: ['--window-position=1280,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.beforeEach(async () => {
    const closePage = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      } catch {}
      await p.close().catch(() => {});
    };
    await closePage(pageTom);
    await closePage(pageJerry);
    await closePage(pageBob);
    await contextTom?.close().catch(() => {});
    await contextJerry?.close().catch(() => {});
    await contextBob?.close().catch(() => {});
    await clearGunDatabases();
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch {}
    };
    await cleanup(pageTom);
    await cleanup(pageJerry);
    await cleanup(pageBob);
    await pageTom?.close();
    await pageJerry?.close();
    await pageBob?.close();
    await contextTom?.close();
    await contextJerry?.close();
    await contextBob?.close();
    await browserTom?.close();
    await browserJerry?.close();
    await browserBob?.close();
    await clearGunDatabases();
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({
      viewport: { width: 640, height: 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await page.goto('/');
    await page.waitForLoadState('load');
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="me"]');
    await afterNav();
    await page.waitForSelector('#edit-stagename-btn');
    await page.click('#edit-stagename-btn');
    await afterAction();
    await page.fill('#new-stage-name', stageName);
    await page.click('#edit-stagename-form button[type="submit"]');
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    return { context, page };
  }

  /** Wait for a tab to be the active one (previous tab restored after modal closes). */
  async function waitForTabActive(page: Page, view: 'chatrooms' | 'talks' | 'contacts' | 'answers' | 'me'): Promise<void> {
    await expect(page.locator(`.nav-btn[data-view="${view}"].active`)).toBeVisible({ timeout: 10000 });
  }

  /** Wait for talk-response modal to close (use after clicking an answer so view is restored). */
  async function waitForResponseModalClosed(page: Page): Promise<void> {
    await page.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
  }

  test('Tennis match: Tom sends, Jerry answers match', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'Tennis Partner');
    await pageTom.selectOption('#talk-type', 'matching');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want a tennis partner?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets play.');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Tennis Partner' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry
      .locator('input.choice-radio[data-answer-text="Yes, lets play."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await waitForTabActive(pageTom, 'chatrooms');
  });

  test('Two talks: Tom Tennis+Coffee, Jerry/Bob match/mismatch; status bar and Answer tab', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'Tennis');
    await pageTom.selectOption('#talk-type', 'matching');
    const q1 = pageTom.locator('.question-item').first();
    await q1.locator('.question-text').fill('Want tennis?');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'Coffee');
    await pageTom.selectOption('#talk-type', 'matching');
    const q2 = pageTom.locator('.question-item').first();
    await q2.locator('.question-text').fill('Coffee?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await afterAction();
    await waitForTabActive(pageTom, 'chatrooms');

    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Tennis' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Coffee' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageJerry.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await afterSync();

    await pageBob.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageBob.locator('.talk-list-item').filter({ hasText: 'Coffee' }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageBob.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageBob);
    await waitForTabActive(pageBob, 'talks');
    await pageBob.locator('.talk-list-item').filter({ hasText: 'Tennis' }).first().click();
    await pageBob.waitForSelector('#talk-response-modal .modal-content', { timeout: 5000 });
    await pageBob.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await afterSync();

    await waitForTabActive(pageTom, 'chatrooms');
    await afterSync();
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(pageTom.locator('#status-bar-text')).toContainText(/2 match/, { timeout: 15000 });
    await pageJerry.click('.nav-btn[data-view="answers"]');
    await afterSync();
    await expect(pageJerry.locator('#answers-content').getByText('Tennis').first()).toBeVisible({ timeout: 10000 });
    await expect(pageJerry.locator('#answers-content').getByText('Coffee').first()).toBeVisible({ timeout: 10000 });
  });

  test('Chatbot: Tom manual match, Bob bot match; Tom no bot icon, Bob has bot icon', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const bob = await bootstrapUser(browserBob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pageBob.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'Tennis');
    await pageTom.selectOption('#talk-type', 'matching');
    const q = pageTom.locator('.question-item').first();
    await q.locator('.question-text').fill('Want tennis?');
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes, lets play.');
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks.');
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await waitForTabActive(pageTom, 'chatrooms');

    await pageJerry.click('.nav-btn[data-view="me"]');
    await afterNav();
    const chatbotCheckbox = pageJerry.locator('#chatbot-enabled-checkbox');
    if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Tennis' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry
      .locator('input.choice-radio[data-answer-text="Yes, lets play."][data-mode="manual"]')
      .first()
      .click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const talkId = await pageTom.locator('.talk-list-item').filter({ hasText: 'Tennis' }).first().getAttribute('data-talk-id');
    expect(talkId).toBeTruthy();
    await pageBob.evaluate(
      async (id: string) => {
        const app = (window as any).__iinpublic_app?.getApp();
        const talk = app.uiManager.getMyTalks()[id].fullTalk;
        const newTalk = await app.talkService.createTalk({
           title: talk.title,
           type: talk.type,
           authorId: app.gunService.getCurrentUser()?.userId || '',
           questions: talk.questions,
           isAdult: false,
           language: talk.language,
           tags: talk.tags,
           isTemplate: true
        });
        setTimeout(() => app.announceTalkToRoom(newTalk.id), 500);
      },
      talkId!,
    );
    await afterSync();
    await waitForTabActive(pageBob, 'chatrooms');

    await pageTom.click('.nav-btn[data-view="me"]');
    await afterSync();
    await expect(pageTom.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first().locator('.conversation-bot-badge')).not.toBeVisible();
    await pageBob.click('.nav-btn[data-view="me"]');
    await afterSync();
    await expect(pageBob.locator('.conversation-list-item').filter({ hasText: 'Jerry' }).first().locator('.conversation-bot-badge')).toBeVisible();
  });

  test('Ignore then change answer: Jerry answers No then reopens and picks Yes → match', async () => {
    const tom = await bootstrapUser(browserTom, 'Tom', 'Tom');
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const jerry = await bootstrapUser(browserJerry, 'Jerry', 'Jerry');
    contextJerry = jerry.context;
    pageJerry = jerry.page;
    await pageJerry.click('.chatroom-item:has-text("Global")');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', 'Tennis Partner');
    await pageTom.selectOption('#talk-type', 'matching');
    await pageTom.click('#add-question-btn');
    await afterAction();
    await pageTom.click('#add-question-btn');
    await afterAction();
    const q0 = pageTom.locator('.question-item').nth(0);
    await q0.locator('.question-text').fill('Do you play tennis?');
    await q0.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('q_1');
    await q0.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    const q1 = pageTom.locator('.question-item').nth(1);
    await q1.locator('.question-text').fill("What's your skill level?");
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('beginner');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('amateur');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_2');
    await q1.locator('.btn-add-answer').click();
    await afterAction();
    await q1.locator('.answer-item').nth(2).locator('.answer-text').fill('professional');
    await q1.locator('.answer-item').nth(2).locator('.answer-next').selectOption('ignore');
    const q2 = pageTom.locator('.question-item').nth(2);
    await q2.locator('.question-text').fill('Available Sundays?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('No');
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await pageTom.click('#broadcast-talk-btn');
    await waitForTabActive(pageTom, 'chatrooms');

    await afterSync();
    await pageJerry.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Tennis Partner' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await pageJerry.locator('input.choice-radio[data-answer-text="amateur"][data-mode="manual"]').first().click();
    await pageJerry.locator('input.choice-radio[data-answer-text="No"][data-mode="manual"]').first().click();
    await pageJerry.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 5000 });

    await afterSync();
    await pageJerry.locator('.talk-list-item').filter({ hasText: 'Tennis Partner' }).first().click();
    await pageJerry.waitForSelector('#talk-response-modal .modal-content', { timeout: 10000 });
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="auto"]').first().click();
    await afterAction();
    await pageJerry.locator('input.choice-radio[data-answer-text="amateur"][data-mode="auto"]').first().click();
    await afterAction();
    await pageJerry.locator('input.choice-radio[data-answer-text="Yes"][data-mode="manual"]').first().click();
    await waitForResponseModalClosed(pageJerry);
    await waitForTabActive(pageJerry, 'talks');
    await waitForTabActive(pageTom, 'chatrooms');
  });
});
