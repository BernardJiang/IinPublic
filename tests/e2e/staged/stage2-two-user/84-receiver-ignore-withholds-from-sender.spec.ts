import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterLoad, delay, headless } from '../../helpers/timing';
import { clickBroadcastUntilBulkAck } from '../../helpers/talk-demo-ui';
import {
  TECH_SUPPORT_NAME,
  TOM_NAME,
  bootstrapSuperUser,
} from '../../helpers/super-user-techsupport-shared';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

/**
 * Bernard, 2026-08-02: "outside of all answers to a question provided by asker, the receiver
 * always has an option to ignore the question. for any multiple question talk, if receiver
 * chooses to ignore any question, then he ignore the whole talk, the sender will never get
 * answer." — verifies the dedicated "Ignore" choice (the always-present opt-out row, distinct
 * from any answer the talk's author provided) withholds the response from the sender entirely,
 * for both flow (single early question) and survey (early question, would otherwise advance).
 *
 * Contrast case ("if receiver chooses any valid answer... designed by sender to terminate
 * early... the sender should still receive the answer") is already covered by
 * 11-mismatch-no-match.spec.ts (clicks a real author-provided "No thanks." answer, confirms the
 * sender DOES receive it) — re-run as part of this change's verification, not duplicated here.
 */
test.describe('Receiver dedicated Ignore withholds the response from the sender', () => {
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

  test('flow and survey: dedicated Ignore ends the response and the sender receives nothing', async () => {
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

    // ── Part 1: flow — dedicated Ignore on the only question ──────────────────────────
    const flowTitle = `DedicatedIgnoreFlow ${Date.now()}`;
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.fill('#talk-title', flowTitle);
    await pageTechSupport.selectOption('#talk-type', 'flow');
    const flowQ = pageTechSupport.locator('.question-item').first();
    await flowQ.locator('.question-text').fill('Ready?');
    await flowQ.locator('.answer-item').nth(0).locator('.answer-text').fill('Yes');
    await flowQ.locator('.answer-item').nth(0).locator('.answer-next').selectOption('noticed');
    await flowQ.locator('.answer-item').nth(1).locator('.answer-text').fill('No thanks');
    await flowQ.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await clickBroadcastUntilBulkAck(pageTechSupport);
    await afterSync();
    await afterSync();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const flowIncoming = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: flowTitle }).first();
    await expect(flowIncoming).toBeVisible({ timeout: 90000 });
    await flowIncoming.locator('button.view-talk-btn').click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });
    // The dedicated Ignore row — distinct from "Yes"/"No thanks", the talk's own answers.
    await pageTom.locator('input.choice-radio.ignore-radio').first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });

    // Tom's own local bookkeeping still happened (completeTalk always runs, regardless of
    // whether the response goes to the sender) — the incoming row flips to "answered" so he
    // isn't re-prompted (rows stay in the list either way, styled differently — same signal
    // 00-ui-navigation-settings.spec.ts already asserts on for ordinary answered talks).
    // (This is the `myTalks`/answered-history bookkeeping, a different store from
    // `localTalkExchanges` — the latter is written inside submitTalkResponsePairDirect, which
    // withholding deliberately never reaches, so a withheld exchange correctly leaves no
    // `localTalkExchanges` trace on either side either.)
    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    await expect(
      pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: flowTitle }),
    ).toHaveClass(/talk-incoming-answered/);

    // TechSupport (the sender) must receive nothing at all — no local record of any kind,
    // held for a few seconds to make sure a delayed mesh delivery isn't just slow to land.
    await pageTechSupport.waitForTimeout(4000);
    const techSupportFlowReceived = await pageTechSupport.evaluate((title) => {
      const raw = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
      return raw.some((r: any) => r.title === title && r.direction !== 'received');
    }, flowTitle);
    expect(techSupportFlowReceived).toBe(false);
    const techSupportFlowLedger = await pageTechSupport.evaluate(() => {
      const app = (window as any).__iinpublic_app.getApp();
      const doc = app.getTalkLedgerDocForE2e() as any;
      return { outcomes: Object.keys(doc.outcomes).length, exchanged: Object.keys(doc.exchanged).length };
    });
    console.log('TechSupport ledger after flow dedicated-ignore:', techSupportFlowLedger);

    // ── Part 2: survey — dedicated Ignore on the first of three questions ─────────────
    const surveyTitle = `DedicatedIgnoreSurvey ${Date.now()}`;
    await pageTechSupport.click('#create-talk-btn');
    await pageTechSupport.waitForSelector('#talk-editor-form');
    await pageTechSupport.fill('#talk-title', surveyTitle);
    await pageTechSupport.selectOption('#talk-type', 'survey');
    await pageTechSupport.click('#add-question-btn');
    await pageTechSupport.click('#add-question-btn');
    // Every question is validator-required to have an Ignore option — answer 0 is that
    // author-designed option; answer 1 is the real, non-ignore choice Tom will pick.
    const sq0 = pageTechSupport.locator('.question-item').nth(0);
    await sq0.locator('.question-text').fill('S1');
    await sq0.locator('.answer-item').nth(0).locator('.answer-text').fill('S1 Author-Ignore');
    await sq0.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await sq0.locator('.answer-item').nth(1).locator('.answer-text').fill('S1 B');
    await sq0.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_1');
    const sq1 = pageTechSupport.locator('.question-item').nth(1);
    await sq1.locator('.question-text').fill('S2');
    await sq1.locator('.answer-item').nth(0).locator('.answer-text').fill('S2 Author-Ignore');
    await sq1.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await sq1.locator('.answer-item').nth(1).locator('.answer-text').fill('S2 B');
    await sq1.locator('.answer-item').nth(1).locator('.answer-next').selectOption('q_2');
    const sq2 = pageTechSupport.locator('.question-item').nth(2);
    await sq2.locator('.question-text').fill('S3');
    await sq2.locator('.answer-item').nth(0).locator('.answer-text').fill('S3 A');
    await sq2.locator('.answer-item').nth(0).locator('.answer-next').selectOption('ignore');
    await sq2.locator('.answer-item').nth(1).locator('.answer-text').fill('S3 B');
    await sq2.locator('.answer-item').nth(1).locator('.answer-next').selectOption('noticed');
    await pageTechSupport.click('#talk-editor-form button[type="submit"]');
    await afterSync();
    await clickBroadcastUntilBulkAck(pageTechSupport);
    await afterSync();
    await afterSync();

    await pageTom.click('.nav-btn[data-view="talks"]');
    await afterSync();
    const surveyIncoming = pageTom.locator('.talk-list-item[data-role="incoming"]').filter({ hasText: surveyTitle }).first();
    await expect(surveyIncoming).toBeVisible({ timeout: 90000 });
    await surveyIncoming.locator('button.view-talk-btn').click();
    await pageTom.waitForSelector('#talk-response-modal .modal-content', { timeout: 25000 });
    await expect(pageTom.locator('#talk-response-modal')).toContainText('S1');
    // Dedicated Ignore on the FIRST of three questions — must end the response immediately
    // (not advance to S2), unlike a real answer (covered by 83-survey-ignore-mid-question-
    // not-complete.spec.ts, which proves a real per-question "ignore-flagged" author answer
    // DOES advance).
    await pageTom.locator('input.choice-radio.ignore-radio').first().click();
    await pageTom.waitForSelector('#talk-response-modal', { state: 'detached', timeout: 15000 });

    // Tom's own local bookkeeping (myTalks/completedAnswers, written by completeTalk
    // regardless of withholding) has exactly one answer — the ignore pick on S1 itself —
    // proof it did not advance through S2/S3 the way a real answer would.
    const tomSurveyRecorded = await pageTom.evaluate((title) => {
      const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      const entry = (Object.values(myTalks) as any[]).find((t) => t.title === title);
      return { found: !!entry, answerCount: Array.isArray(entry?.completedAnswers) ? entry.completedAnswers.length : -1 };
    }, surveyTitle);
    expect(tomSurveyRecorded.found).toBe(true);
    expect(tomSurveyRecorded.answerCount).toBe(1);

    await pageTechSupport.waitForTimeout(4000);
    const techSupportSurveyReceived = await pageTechSupport.evaluate((title) => {
      const raw = Object.values(JSON.parse(localStorage.getItem('localTalkExchanges') || '{}')) as any[];
      return raw.some((r: any) => r.title === title && r.direction !== 'received');
    }, surveyTitle);
    expect(techSupportSurveyReceived).toBe(false);

    console.log('✅ Dedicated Ignore withheld both flow and survey responses from the sender.');
  });
});
