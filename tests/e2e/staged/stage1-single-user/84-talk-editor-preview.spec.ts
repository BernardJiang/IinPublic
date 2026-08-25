/**
 * Live "what the responder sees" preview — talk editor usability follow-up.
 * `src/web/ui/talk-editor-preview.ts` reads the CURRENT in-progress form state (not the saved
 * talk), runs it through the same `TalkAutofix.fix` the real save path uses, and lets the author
 * click through their own structure using the real `checkIfMatch` (talk-engine.ts) to decide the
 * outcome — not a reimplementation. Single browser, no save/broadcast needed: everything here is
 * local to the open editor.
 */
import { Browser } from '@playwright/test';
import { chromium } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';

test.describe('Talk editor: live responder preview', () => {
  let browser: Browser;

  test.beforeEach(async () => {
    await clearGunForStage1Spec();
    browser = await chromium.launch({ headless });
  });

  test.afterEach(async () => {
    await browser?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  test('flow talk: walks to a match, restarts to an ignore, and re-derives live on edit', async () => {
    const user = await bootstrapUser(browser, 'Preview', 'PreviewUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', 'Coffee or Tea');
    await page.selectOption('#talk-type', 'flow');

    // Add both questions up front so Q1's "Go to Question 2" dropdown option already exists by
    // the time we pick it (`.answer-next`'s options are computed from the LIVE question count).
    await page.click('#add-question-btn');

    const q1 = page.locator('.question-item[data-question-index="0"]');
    await q1.locator('.question-text').fill('Do you like coffee?');
    await q1.locator('.answer-item[data-answer-index="0"] .answer-text').fill('Yes');
    await q1.locator('.answer-item[data-answer-index="0"] .answer-next').selectOption('q_1');
    await q1.locator('.answer-item[data-answer-index="1"] .answer-text').fill('No');
    await q1.locator('.answer-item[data-answer-index="1"] .answer-next').selectOption('ignore');

    const q2 = page.locator('.question-item[data-question-index="1"]');
    await q2.locator('.question-text').fill('Do you like tea?');
    await q2.locator('.answer-item[data-answer-index="0"] .answer-text').fill('Yes');
    await q2.locator('.answer-item[data-answer-index="0"] .answer-next').selectOption('noticed');
    await q2.locator('.answer-item[data-answer-index="1"] .answer-text').fill('No');
    await q2.locator('.answer-item[data-answer-index="1"] .answer-next').selectOption('ignore');

    // Open the preview — starts collapsed (progressive disclosure applies to it too).
    const details = page.locator('#talk-preview-details');
    await expect(details).not.toHaveJSProperty('open', true);
    await page.locator('#talk-preview-details summary').click();
    await expect(details).toHaveJSProperty('open', true);

    const body = page.locator('#talk-preview-body');
    await expect(body).toContainText('Do you like coffee?');

    // Walk to a match: Yes -> Yes.
    await body.locator('.talk-preview-answer-btn', { hasText: 'Yes' }).click();
    await expect(body).toContainText('Do you like tea?');
    await body.locator('.talk-preview-answer-btn', { hasText: 'Yes' }).click();
    await expect(body).toContainText('This would be a match');

    // Restart, walk to an ignore this time: Yes -> No.
    await body.locator('.talk-preview-restart-btn').click();
    await expect(body).toContainText('Do you like coffee?');
    await body.locator('.talk-preview-answer-btn', { hasText: 'Yes' }).click();
    await body.locator('.talk-preview-answer-btn', { hasText: 'No' }).click();
    await expect(body).toContainText('filtered out');

    // Live update: editing Q1's text while the preview is open re-derives from scratch —
    // the panel picks up the new wording without the author reopening it.
    await q1.locator('.question-text').fill('Do you like espresso?');
    await expect(body).toContainText('Do you like espresso?', { timeout: 3_000 });
  });

  test('route talk: parallel spec fan-out preview walks to a match', async () => {
    const user = await bootstrapUser(browser, 'RoutePreview', 'RoutePreviewUser');
    const { page } = user;

    await page.click('.nav-btn[data-view="talks"]');
    await waitForTabActive(page, 'talks');
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', 'Buy stuff preview');
    await page.selectOption('#talk-type', 'route');
    await expect(page.locator('#route-editor')).toBeVisible();

    // q_0 root: "buy" -> single answer "sell" chains to q_1. Filling the question text mirrors
    // onto the lone match answer (route-editor convenience for a fresh node); filling the answer
    // text directly afterward opts out of that mirror with our own wording.
    await page.locator('.route-question-text[data-qid="q_0"]').fill('buy');
    await page.locator('.route-answer-text[data-qid="q_0"][data-aid="a_0_match"]').fill('sell');
    await page.locator('.route-add-child-btn[data-qid="q_0"][data-aid="a_0_match"]').click();

    // q_1: "iphone" — leave the mirrored answer text as-is (self-match "iphone"), fan its one
    // answer out into two parallel specs.
    await page.locator('.route-question-text[data-qid="q_1"]').fill('iphone');
    await page.locator('.route-add-child-btn[data-qid="q_1"][data-aid="q_1_match"]').click(); // -> q_2
    await page.locator('.route-add-child-btn[data-qid="q_1"][data-aid="q_1_match"]').click(); // -> q_3, parallel

    await page.locator('.route-question-text[data-qid="q_2"]').fill('model');
    await page.locator('.route-answer-text[data-qid="q_2"][data-aid="q_2_match"]').fill('16pro');

    await page.locator('.route-question-text[data-qid="q_3"]').fill('condition');
    await page.locator('.route-answer-text[data-qid="q_3"][data-aid="q_3_match"]').fill('used');

    await page.locator('#talk-preview-details summary').click();
    const body = page.locator('#talk-preview-body');
    await expect(body).toContainText('sell');
    await body.locator('.talk-preview-answer-btn', { hasText: 'sell' }).click();
    await expect(body).toContainText('iphone');
    await body.locator('.talk-preview-answer-btn', { hasText: 'iphone' }).click();
    await expect(body).toContainText('model');
    await body.locator('.talk-preview-answer-btn', { hasText: '16pro' }).click();
    await expect(body).toContainText('condition');
    await body.locator('.talk-preview-answer-btn', { hasText: 'used' }).click();
    await expect(body).toContainText('This would be a match');
  });
});
