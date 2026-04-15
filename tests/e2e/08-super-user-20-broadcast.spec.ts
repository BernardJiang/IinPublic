import { test, expect, chromium, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { clearGunDatabases } from './helpers/clear-database';
import { delay, headless, afterAction, afterNav, afterSync, afterLoad } from './helpers/timing';
import { countIncomingTalkSlots } from './helpers/talks-matching-flow';
import {
  TAG_NAMES,
  TALK_TITLES,
  MATCH_ANSWER,
  IGNORE_ANSWER,
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
  waitForTabActive,
  openTomIncomingModal,
} from './helpers/super-user-techsupport-shared';

test.describe('Super user: 20 talks broadcast to Tom', () => {
  let browserTechSupport: Browser;
  let browserTom: Browser;
  let contextTechSupport: BrowserContext;
  let contextTom: BrowserContext;
  let pageTechSupport: Page;
  let pageTom: Page;

  const screenshotDir = path.join(__dirname, '../../test-screenshots/08-super-user');

  test.beforeAll(async () => {
    await clearGunDatabases();

    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    browserTechSupport = await chromium.launch({
      headless,
      slowMo: delay(50, 120),
      args: ['--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: delay(50, 120),
      args: ['--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    console.log('🚀 Launched 2 Chrome browsers: TechSupport, Tom');
  });

  test.afterEach(async () => {
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    contextTechSupport = undefined as unknown as BrowserContext;
    contextTom = undefined as unknown as BrowserContext;
    pageTechSupport = undefined as unknown as Page;
    pageTom = undefined as unknown as Page;
  });

  test.afterAll(async () => {
    const manualCleanup = async (page?: Page) => {
      if (!page) return;
      try {
        await page.evaluate(() => {
          const webApp = (window as any).__iinpublic_app;
          if (webApp?.getApp) webApp.getApp().manualCleanup();
        });
      } catch {
        // ignore
      }
    };
    await manualCleanup(pageTechSupport);
    await manualCleanup(pageTom);
    await pageTechSupport?.close().catch(() => {});
    await pageTom?.close().catch(() => {});
    await contextTechSupport?.close().catch(() => {});
    await contextTom?.close().catch(() => {});
    await browserTechSupport?.close().catch(() => {});
    await browserTom?.close().catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    await clearGunDatabases();
    console.log('✅ Cleanup complete');
  });

  test('TechSupport creates 10 tags + 10 talks, answers all himself (in UI); Tom joins; TechSupport sends all 20; Tom answers all; TechSupport confirms', async () => {
    test.setTimeout(900_000);

    console.log('\n📍 STEP 1: TechSupport enters Global');
    const techSupport = await bootstrapSuperUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    await pageTechSupport.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterNav();

    console.log('\n📍 STEP 2: TechSupport creates 10 tags');
    for (const tagName of TAG_NAMES) {
      await pageTechSupport.click('#create-talk-btn');
      await pageTechSupport.waitForSelector('#talk-editor-form');
      await pageTechSupport.click('input[name="talk-type-radio"][value="tag"]');
      await afterAction();
      await pageTechSupport.fill('#talk-title', tagName);
      await pageTechSupport.click('#talk-editor-form button[type="submit"]');
      await afterSync();
    }

    console.log('\n📍 STEP 3: TechSupport creates 10 talks');
    for (const title of TALK_TITLES) {
      await pageTechSupport.click('#create-talk-btn');
      await pageTechSupport.waitForSelector('#talk-editor-form');
      await pageTechSupport.click('input[name="talk-type-radio"][value="matching"]');
      await afterAction();
      await pageTechSupport.fill('#talk-title', title);
      const q = pageTechSupport.locator('.question-item').first();
      await q.locator('.question-text').fill(`Want to connect for ${title}?`);
      await q.locator('.answer-item').nth(0).locator('.answer-text').fill(MATCH_ANSWER);
      await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
      await q.locator('.answer-item').nth(1).locator('.answer-text').fill(IGNORE_ANSWER);
      await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
      await pageTechSupport.click('#talk-editor-form button[type="submit"]');
      await afterSync();
    }

    console.log('\n📍 STEP 4: TechSupport has 20 created (10 tags + 10 talks)');

    console.log('\n📍 STEP 5: Tom joins Global');
    const tom = await bootstrapSuperUser(browserTom, 'Tom', TOM_NAME);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    console.log('\n📍 STEP 6: TechSupport broadcasts all 20 to Tom');
    await pageTechSupport.click('.nav-btn[data-view="chatrooms"]');
    await afterAction();
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterNav();
    await pageTechSupport.click('#broadcast-talk-btn');
    await waitForTabActive(pageTechSupport, 'chatrooms');
    await expect(
      pageTechSupport.getByText(/Sent 20 talks to 1 user in the room\./),
    ).toBeVisible({ timeout: 180_000 });

    const tomUserId = await pageTom.evaluate(() =>
      String(
        (
          window as unknown as {
            __iinpublic_app?: { getApp: () => { currentUser?: { id: string } } };
          }
        ).__iinpublic_app?.getApp?.()?.currentUser?.id || '',
      ),
    );
    expect(tomUserId.length, 'Tom user id for incoming-talks check').toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const res = await pageTom.request.get(
            `http://localhost:8080/api/users/${encodeURIComponent(tomUserId)}/incoming-talks`,
          );
          if (!res.ok()) return 0;
          const data = await res.json();
          return countIncomingTalkSlots(data);
        },
        { message: 'Tom should have 20 incoming talk slots after broadcast', timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(20);

    console.log('\n📍 STEP 7: Tom answers all 20');
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterLoad();

    for (const tagName of TAG_NAMES) {
      await openTomIncomingModal(pageTom, tagName, 'tag');
      await pageTom.waitForSelector('#tag-match-checkbox', { state: 'visible', timeout: 15000 });
      await pageTom.locator('#tag-match-checkbox').check();
      await pageTom.click('#tag-submit-btn');
      await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
      await afterAction();
    }

    for (const talkTitle of TALK_TITLES) {
      await openTomIncomingModal(pageTom, talkTitle, 'matching');
      await pageTom.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
      await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });
      await afterAction();
    }

    console.log('\n📍 STEP 8: TechSupport confirms all 20 answers');
    await afterLoad();
    await pageTechSupport.click('.nav-btn[data-view="talks"]');
    await afterLoad();
    await expect(pageTechSupport.getByText(/Matched with:/).first()).toBeVisible({ timeout: 15000 });
    const statusBar = pageTechSupport.locator('#status-bar-text');
    await expect(statusBar).toContainText(/20 match(es)?/, { timeout: 25000 });
    const matchedLines = await pageTechSupport.getByText(/Matched with:/).count();
    expect(matchedLines).toBeGreaterThanOrEqual(1);

    await pageTom.click('.nav-btn[data-view="answers"]');
    await afterLoad();
    const answersContent = pageTom.locator('#answers-content');
    for (const name of [...TAG_NAMES, ...TALK_TITLES]) {
      await expect(answersContent.getByText(name).first()).toBeVisible({ timeout: 3000 });
    }
    await expect(answersContent.getByText(/Match/).first()).toBeVisible({ timeout: 3000 });

    console.log('✅ Super user test complete: TechSupport created 20, sent to Tom, Tom answered all, TechSupport confirmed.');
  });
});
