import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from './helpers/fixtures';
import { clearGunDatabases, injectIdbClear } from './helpers/clear-database';
import { ensureWindowFitsViewport } from './helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from './helpers/timing';
import { gunBaseURL, webBaseURL } from './helpers/ports';
import { openIncomingTalkModal, waitForResponseModalClosed } from './helpers/talks-matching-flow';
import { confirmBroadcastTagPreambleIfVisible } from './helpers/broadcast-preamble';
import { waitForStatusBarMatchCountAtLeast } from './helpers/durable-ui';

test.describe('Contacts tab: list of users with matches, click to see matching talks', () => {
  let browserTom: Browser;
  let browserJerry: Browser;
  let browserBob: Browser;
  let contextTom: BrowserContext;
  let contextJerry: BrowserContext;
  let contextBob: BrowserContext;
  let pageTom: Page;
  let pageJerry: Page;
  let pageBob: Page;

  const TALK_TENNIS = 'Tennis';
  const TALK_COFFEE = 'Coffee';
  const MATCH_ANSWER = 'Yes, lets play.';
  const MATCH_ANSWER_COFFEE = 'Yes, coffee sounds good.';
  const IGNORE_ANSWER = 'No thanks.';
  const IGNORE_ANSWER_COFFEE = 'Not now.';

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunDatabases();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: ['--window-position=1280,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      try {
        await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
      } catch { }
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
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => console.log(`[${label}]:`, m.text()));
    await injectIdbClear(page);
    await page.goto(webBaseURL());
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

  test('Contacts tab shows users with matches; click contact shows matching talks', async () => {
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

    await pageTom.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterNav();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_TENNIS);
    await pageTom.selectOption('#talk-type', 'flow');
    const q1 = pageTom.locator('.question-item').first();
    await q1.locator('.question-text').fill('Want a tennis partner?');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await pageTom.click('#create-talk-btn');
    await pageTom.waitForSelector('#talk-editor-form');
    await pageTom.fill('#talk-title', TALK_COFFEE);
    await pageTom.selectOption('#talk-type', 'flow');
    const q2 = pageTom.locator('.question-item').first();
    await q2.locator('.question-text').fill('Want to grab coffee?');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER_COFFEE);
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER_COFFEE);
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTom.click('#talk-editor-form button[type="submit"]');
    await afterSync();

    await pageTom.click('#broadcast-talk-btn');

    await confirmBroadcastTagPreambleIfVisible(pageTom);
    await afterSync();
    // Poll server until Jerry has received both talks (broadcast takes time to register)
    const jerryUserId = await pageJerry.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(
            `${gunBaseURL()}/api/users/${encodeURIComponent(jerryUserId)}/incoming-talks`,
          );
          if (!res.ok()) return 0;
          return (await res.json() as any[]).length;
        },
        { message: 'Jerry should have incoming talks after broadcast', timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(1);

    await openIncomingTalkModal(pageJerry, TALK_TENNIS);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForStatusBarMatchCountAtLeast(pageJerry, 1);
    await waitForResponseModalClosed(pageJerry);
    await afterAction();

    await openIncomingTalkModal(pageJerry, TALK_COFFEE);
    await pageJerry.locator(`input.choice-radio[data-answer-text="${IGNORE_ANSWER_COFFEE}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(pageJerry);

    await openIncomingTalkModal(pageBob, TALK_COFFEE);
    await pageBob.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER_COFFEE}"][data-mode="manual"]`).first().click();
    await waitForStatusBarMatchCountAtLeast(pageBob, 1);
    await waitForResponseModalClosed(pageBob);
    await afterAction();

    await openIncomingTalkModal(pageBob, TALK_TENNIS);
    await pageBob.locator(`input.choice-radio[data-answer-text="${IGNORE_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(pageBob);

    await waitForStatusBarMatchCountAtLeast(pageTom, 2);
    await afterSync();
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-item')).toHaveCount(2, { timeout: 15000 });
    await expect(pageTom.locator('#contacts-list').getByText('Jerry')).toBeVisible({ timeout: 5000 });
    await expect(pageTom.locator('#contacts-list').getByText('Bob')).toBeVisible({ timeout: 5000 });
    await pageTom.locator('.contact-item').filter({ hasText: 'Jerry' }).first().click();
    await afterNav();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('.contact-talk-item').filter({ hasText: TALK_TENNIS })).toBeVisible({ timeout: 10000 });
    await pageTom.click('#back-to-contacts-list');
    await afterAction();
    await pageTom.locator('.contact-item').filter({ hasText: 'Bob' }).first().click();
    await afterNav();
    await expect(pageTom.locator('#contact-detail-name')).toContainText('Bob', { timeout: 10000 });
    await expect(pageTom.locator('.contact-talk-item').filter({ hasText: TALK_COFFEE })).toBeVisible({ timeout: 10000 });

    await pageJerry.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await expect(pageJerry.locator('#contacts-list .contact-item')).toHaveCount(1, { timeout: 10000 });
    await pageJerry.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await afterNav();
    await expect(pageJerry.locator('.contact-talk-item').filter({ hasText: TALK_TENNIS })).toBeVisible({ timeout: 10000 });

    await pageBob.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await expect(pageBob.locator('#contacts-list .contact-item')).toHaveCount(1, { timeout: 10000 });
    await pageBob.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await afterNav();
    await expect(pageBob.locator('.contact-talk-item').filter({ hasText: TALK_COFFEE })).toBeVisible({ timeout: 10000 });
  });
});
