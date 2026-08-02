import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, afterLoad, delay, headless } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import {
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
} from '../../helpers/super-user-techsupport-shared';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

/**
 * docs/TODO.md §W Gap 2 completeness note — Bernard, 2026-08-01: "if receiver answers 2 out of
 * 3 questions talk, it is considered not yet done on his side. the sender should not receive
 * incomplete answer and should consider not yet answered."
 *
 * Verifies the root-cause fix: picking a survey question's "Ignore" answer on a non-last
 * question must NOT end the response early — it should behave like any other answer (advance
 * to the next question), because every survey question is validator-required to have an
 * Ignore option but that only means "not interested in this one question," not "abandon the
 * whole survey." Only the actual last question ends the response.
 */
test.describe('Survey: Ignore on a non-last question does not end the response early', () => {
  let browserTechSupport: Browser;
  let browserTom: Browser;
  let contextTechSupport: BrowserContext;
  let contextTom: BrowserContext;
  let pageTechSupport: Page;
  let pageTom: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserTechSupport = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
    browserTom = await chromium.launch({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1200', '--force-device-scale-factor=1'],
    });
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
    await clearGunForStage2Spec();
  });

  test('a mid-survey Ignore advances instead of completing; only the last question ends it', async () => {
    test.setTimeout(300_000);

    const techSupport = await bootstrapSuperUser(browserTechSupport, 'TechSupport', TECH_SUPPORT_NAME);
    contextTechSupport = techSupport.context;
    pageTechSupport = techSupport.page;
    await pageTechSupport.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    const tom = await bootstrapSuperUser(browserTom, 'Tom', TOM_NAME);
    contextTom = tom.context;
    pageTom = tom.page;
    await pageTom.click('.chatroom-item:has-text("Global")');
    await afterLoad();

    const surveyTitle = `IgnoreMidSurvey ${Date.now()}`;
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.fill('#talk-title', surveyTitle);
    await pageTechSupport.selectOption('#talk-type', 'survey');
    // Two more questions (3 total) — #add-question-btn is only present once the type select
    // has switched the form into the linear (non-tag) editor.
    await pageTechSupport.click('#add-question-btn');
    await pageTechSupport.click('#add-question-btn');

    const q0 = pageTechSupport.locator('.question-item').nth(0);
    await q0.locator('.question-text').fill('Q1');
    await q0.locator('.answer-item').nth(0).locator('.answer-text').fill('Q1 Ignore');
    await q0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q0.locator('.answer-item').nth(1).locator('.answer-text').fill('Q1 Keep');
    // A freshly-added answer row's dropdown defaults to "ignore" (the first <option>, no
    // explicit selection) — must be set explicitly or this answer would be isIgnore too.
    await q0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_1');

    const q1 = pageTechSupport.locator('.question-item').nth(1);
    await q1.locator('.question-text').fill('Q2');
    await q1.locator('.answer-item').nth(0).locator('.answer-text').fill('Q2 Ignore');
    await q1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q1.locator('.answer-item').nth(1).locator('.answer-text').fill('Q2 Keep');
    await q1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_2');

    const q2 = pageTechSupport.locator('.question-item').nth(2);
    await q2.locator('.question-text').fill('Q3');
    await q2.locator('.answer-item').nth(0).locator('.answer-text').fill('Q3 Ignore');
    await q2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await q2.locator('.answer-item').nth(1).locator('.answer-text').fill('Q3 Match');
    await q2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('noticed');

    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await clickBroadcastUntilBulkAck(pageTechSupport);
    await afterSync();
    await afterSync();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const incomingRow = pageTom
      .locator('.talk-list-item[data-role="incoming"]')
      .filter({ hasText: surveyTitle })
      .first();
    await expect(incomingRow).toBeVisible({ timeout: 90000 });
    await incomingRow.locator('button.view-talk-btn').click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });

    // ── Q1: pick the Ignore answer — must advance to Q2, NOT complete/close ──
    await pageTom.locator('input.choice-radio[data-answer-text="Q1 Ignore"][data-mode="manual"]').first().click();
    await afterAction();
    await expect(pageTom.locator('#talk-response-modal')).toBeVisible();
    await expect(pageTom.locator('#talk-response-modal')).toContainText('Q2');
    await expect(pageTom.locator('#talk-response-modal')).toContainText('Question 2 of 3');

    // ── Q2: pick the non-ignore answer — must advance to Q3, NOT complete/close ──
    await pageTom.locator('input.choice-radio[data-answer-text="Q2 Keep"][data-mode="manual"]').first().click();
    await afterAction();
    await expect(pageTom.locator('#talk-response-modal')).toBeVisible();
    await expect(pageTom.locator('#talk-response-modal')).toContainText('Q3');
    await expect(pageTom.locator('#talk-response-modal')).toContainText('Question 3 of 3');

    // ── Q3 (the actual last question): pick Match — this is what finally ends it ──
    await pageTom.locator('input.choice-radio[data-answer-text="Q3 Match"][data-mode="manual"]').first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });

    // ── Tom's own record (direction:'received' — he received the talk and answered it)
    // has all 3 answers, not just the first one. completeTalk's 'talkCompleted' handler is
    // async (Gun SEA write + mesh send before recordLocalTalkExchange) — poll rather than
    // read immediately after the modal detaches.
    await expect
      .poll(
        async () => pageTom.evaluate((title) => {
          const raw = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
          const rsp = raw.find((r: any) => r.title === title && r.direction === 'received');
          return Array.isArray(rsp?.answers) ? rsp.answers.length : -1;
        }, surveyTitle),
        { message: 'Tom should have recorded all 3 survey answers', timeout: 15_000 },
      )
      .toBe(3);

    // ── TechSupport (the sender/author, direction:'sent' — a response TO a talk it sent)
    // received the FULL 3-answer response, not a 1-answer partial from the Q1 Ignore pick ──
    await expect
      .poll(
        async () => pageTechSupport.evaluate((title) => {
          const raw = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
          const rsp = raw.find((r: any) => r.title === title && r.direction !== 'received');
          return Array.isArray(rsp?.answers) ? rsp.answers.length : -1;
        }, surveyTitle),
        { message: 'TechSupport should receive the full 3-answer survey response', timeout: 30_000 },
      )
      .toBe(3);

    console.log('✅ Mid-survey Ignore correctly advanced instead of completing early.');
  });
});
