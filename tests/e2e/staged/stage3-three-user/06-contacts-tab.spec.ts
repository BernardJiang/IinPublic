import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { injectIdbClear, gotoWebApp } from '../../helpers/clear-database';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { ensureWindowFitsViewport } from '../../helpers/browser-window';
import { afterLoad, afterSync, afterNav, afterAction, delay, headless } from '../../helpers/timing';
import { webAppURLStableChatroom } from '../../helpers/ports';
import {
  completeTalkInAppByAnswerIds,
  createTalksFromCompanyPage,
} from '../../helpers/talk-demo-ui';
import { waitForStatusBarMatchCountAtLeast, waitForPeerHistoryTitle, waitForContactDetailReady } from '../../helpers/durable-ui';
import { attachE2eBrowserTabLabel } from '../../helpers/e2e-tab-title';
import { attachFilteredConsoleLog } from '../../helpers/e2e-console';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

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
  const TENNIS_MATCH_ID = 'a_tennis_yes';
  const TENNIS_IGNORE_ID = 'a_tennis_no';
  const COFFEE_MATCH_ID = 'a_coffee_yes';
  const COFFEE_IGNORE_ID = 'a_coffee_no';

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserJerry = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserBob = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=1280,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
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
    await clearGunForStage3Spec();
  });

  async function bootstrapUser(
    browser: Browser,
    label: string,
    stageName: string,
  ): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    attachFilteredConsoleLog(page, label);
    await injectIdbClear(page);
    await gotoWebApp(page, webAppURLStableChatroom());
    await ensureWindowFitsViewport(page, 640, 1000);
    await afterLoad();
    await page.click('.nav-btn[data-view="settings"]');
    await afterNav();
    await page.waitForSelector('#settings-stage-name-input');
    await page.fill('#settings-stage-name-input', stageName);
    await page.locator('#settings-stage-name-input').blur();
    await afterNav();
    await page.click('.nav-btn[data-view="chatrooms"]');
    await afterNav();
    attachE2eBrowserTabLabel(page, label);
    return { context, page };
  }

  async function currentUserId(page: Page): Promise<string> {
    return page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '');
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

    const [tennis, coffee] = await createTalksFromCompanyPage(pageTom, [
      {
        title: TALK_TENNIS,
        type: 'flow',
        language: 'en',
        questions: [{
          id: 'q_tennis',
          text: 'Want a tennis partner?',
          answers: [
            { id: TENNIS_MATCH_ID, text: MATCH_ANSWER, isMatch: true, isTerminal: true },
            { id: TENNIS_IGNORE_ID, text: IGNORE_ANSWER, isIgnore: true, isTerminal: true },
          ],
        }],
        selfAnswers: [{ questionId: 'q_tennis', answerId: TENNIS_MATCH_ID }],
      },
      {
        title: TALK_COFFEE,
        type: 'flow',
        language: 'en',
        questions: [{
          id: 'q_coffee',
          text: 'Want to grab coffee?',
          answers: [
            { id: COFFEE_MATCH_ID, text: MATCH_ANSWER_COFFEE, isMatch: true, isTerminal: true },
            { id: COFFEE_IGNORE_ID, text: IGNORE_ANSWER_COFFEE, isIgnore: true, isTerminal: true },
          ],
        }],
        selfAnswers: [{ questionId: 'q_coffee', answerId: COFFEE_MATCH_ID }],
      },
    ]);

    await completeTalkInAppByAnswerIds(pageJerry, tennis.talkId, tennis.talkData, [TENNIS_MATCH_ID], 'match');
    await waitForStatusBarMatchCountAtLeast(pageJerry, 1);

    await completeTalkInAppByAnswerIds(pageJerry, coffee.talkId, coffee.talkData, [COFFEE_IGNORE_ID], 'mismatch');

    await completeTalkInAppByAnswerIds(pageBob, coffee.talkId, coffee.talkData, [COFFEE_MATCH_ID], 'match');
    await waitForStatusBarMatchCountAtLeast(pageBob, 1);

    await completeTalkInAppByAnswerIds(pageBob, tennis.talkId, tennis.talkData, [TENNIS_IGNORE_ID], 'mismatch');

    const tomUserId = await currentUserId(pageTom);
    const jerryUserId = await currentUserId(pageJerry);
    const bobUserId = await currentUserId(pageBob);
    await waitForPeerHistoryTitle(pageTom, tomUserId, jerryUserId, TALK_TENNIS);
    await waitForPeerHistoryTitle(pageTom, tomUserId, bobUserId, TALK_COFFEE);
    await waitForPeerHistoryTitle(pageJerry, jerryUserId, tomUserId, TALK_TENNIS);
    await waitForPeerHistoryTitle(pageBob, bobUserId, tomUserId, TALK_COFFEE);

    await afterSync();
    await pageTom.click('.nav-btn[data-view="contacts"]');
    await afterAction();
    await expect(pageTom.locator('#contacts-list .contact-support-item')).toHaveCount(1, { timeout: 15000 });
    await expect(pageTom.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(2, { timeout: 15000 });
    await expect(pageTom.locator('#contacts-list').getByText('Jerry')).toBeVisible({ timeout: 5000 });
    await expect(pageTom.locator('#contacts-list').getByText('Bob')).toBeVisible({ timeout: 5000 });
    await pageTom.locator('.contact-item').filter({ hasText: 'Jerry' }).first().click();
    await afterNav();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Jerry', { timeout: 10000 });
    await expect(pageTom.locator('.peer-history-item').filter({ hasText: TALK_TENNIS })).toBeVisible({ timeout: 10000 });
    await pageTom.click('#back-from-peer-detail');
    await afterAction();
    await pageTom.locator('.contact-item').filter({ hasText: 'Bob' }).first().click();
    await afterNav();
    await waitForContactDetailReady(pageTom);
    await expect(pageTom.locator('#peer-detail-name')).toContainText('Bob', { timeout: 10000 });
    await expect(pageTom.locator('.peer-history-item').filter({ hasText: TALK_COFFEE })).toBeVisible({ timeout: 10000 });

    await pageJerry.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await expect(pageJerry.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(1, { timeout: 10000 });
    await pageJerry.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await afterNav();
    await waitForContactDetailReady(pageJerry);
    await expect(pageJerry.locator('.peer-history-item').filter({ hasText: TALK_TENNIS })).toBeVisible({ timeout: 10000 });

    await pageBob.click('.nav-btn[data-view="contacts"]');
    await afterSync();
    await expect(pageBob.locator('#contacts-list .contact-item:not([data-support-contact="true"])')).toHaveCount(1, { timeout: 10000 });
    await pageBob.locator('.contact-item').filter({ hasText: 'Tom' }).first().click();
    await afterNav();
    await waitForContactDetailReady(pageBob);
    await expect(pageBob.locator('.peer-history-item').filter({ hasText: TALK_COFFEE })).toBeVisible({ timeout: 10000 });
  });
});
