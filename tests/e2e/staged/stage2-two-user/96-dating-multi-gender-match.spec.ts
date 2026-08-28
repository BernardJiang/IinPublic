/**
 * §DD: the reshaped Dating template's multi-value gender preference, matched end to end via a
 * real cross-browser chatbot auto-reply (zero manual clicks) — not just the structural prefill
 * checks `83-talk-template-picker.spec.ts` covers, and not just the unit-level fan-out veto
 * proof in `talk-engine.test.ts`. Built via three real, empirically-found fixes this same
 * session (see `talk-templates.ts`'s own doc comment on `buildDatingTemplate` for the full
 * writeup): the DAG-walk in `tryBuildChatbotAnswersFromFlattened`
 * (answer-preference-resolution.ts), the grammar/spam intake filter deduplicating legitimately
 * repeated branch text (`talk-intake-filters.ts`), and `collectRouteEditorQuestions` preserving
 * a builtIn root's fan-out `parallelMatchThreshold` on save (route-editor-model.ts) — none of
 * which were exercised by any prior spec (fan-out was previously only proven via MANUAL
 * responder walking, `93-route-parallel-spec-fanout-buy-sell.spec.ts`).
 *
 * Two scenarios, proving the discrimination actually works both ways, not just that SOME match
 * forms:
 * 1. Adam's talk (template default: accepts men/women/non-binary people) receives Eve, who
 *    edits her own counterpart talk to declare herself "women" — matches, via the "women"
 *    branch specifically (the "men"/"non-binary people" branches correctly fail to auto-answer
 *    for her, per the chatbot's existing PREFERENCE_CONFLICT gate — this is what proves it's
 *    real discrimination, not a permissive fallback).
 * 2. Adam's talk with the "men" branch removed (accepts only women/non-binary people) receives
 *    Chris, a man — no match forms at all.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { serverVouchAgeVerified } from '../../helpers/reputation-e2e-helpers';

async function pickDatingTemplate(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-modal');
  await page.click('#browse-talk-templates-btn');
  await page.waitForSelector('#talk-template-picker-modal');
  await page.click('[data-testid="talk-template-dating"]');
  await page.waitForSelector('.route-question-text[data-qid="q_0"]');
}

/** Edit all 3 branches' own "myGender" text (q_1/q_2/q_3) — e.g. "women" for a woman author.
 *  `checkIfMatch`'s veto is exact-text, so this must be the literal word another author's
 *  talk accepts, not a synonym (see `buildDatingTemplate`'s own doc comment). */
async function setMyGender(page: Page, myGender: string): Promise<void> {
  for (const qid of ['q_1', 'q_2', 'q_3']) {
    await page.locator(`.route-question-text[data-qid="${qid}"]`).fill(myGender);
  }
}

async function enableChatbot(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const cb = page.locator('#settings-chatbot-enabled');
  if (!(await cb.isChecked())) await cb.click();
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
}

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

async function hasConversationWith(page: Page, otherUserId: string): Promise<boolean> {
  return page.evaluate((otherUserId) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    return Object.values(conversations).some((c: any) => c && c.supportChannel !== true && String(c.otherUserId || '') === otherUserId);
  }, otherUserId);
}

test.describe('Dating template: multi-gender preference matching (§DD)', () => {
  let browserAdam: Browser;
  let browserOther: Browser;
  let contextAdam: BrowserContext;
  let contextOther: BrowserContext;
  let pageAdam: Page;
  let pageOther: Page;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserAdam, browserOther] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageAdam, pageOther]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextAdam?.close?.().catch(() => {}), contextOther?.close?.().catch(() => {})]);
    await Promise.all([browserAdam?.close().catch(() => {}), browserOther?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('Eve, declared "women", matches Adam\'s default talk (accepts men/women/non-binary people) — zero manual clicks', async () => {
    test.setTimeout(120_000);
    const adam = await bootstrapUser(browserAdam, 'Adam', 'AdamDatingMulti');
    contextAdam = adam.context;
    pageAdam = adam.page;
    const eve = await bootstrapUser(browserOther, 'Eve', 'EveDatingMulti');
    contextOther = eve.context;
    pageOther = eve.page;

    // Adam: template as-is.
    await pickDatingTemplate(pageAdam);
    await pageAdam.locator('#talk-send-to-chatroom').setChecked(false);
    await expect(pageAdam.locator('#talk-validation-errors')).not.toBeVisible();
    await submitTalkEditorAndWaitForOut(pageAdam, 'Dating');

    // Eve: her own counterpart talk, edited to declare herself "women" — the exact word Adam's
    // template accepts on its q_2 branch. Never broadcasts; exists purely to seed her own
    // chatbot memory, same "counterpart talk exists but never broadcasts" pattern
    // 87-price-overlap-buy-sell-match.spec.ts uses.
    await pickDatingTemplate(pageOther);
    await setMyGender(pageOther, 'women');
    await pageOther.locator('#talk-send-to-chatroom').setChecked(false);
    await expect(pageOther.locator('#talk-validation-errors')).not.toBeVisible();
    await submitTalkEditorAndWaitForOut(pageOther, 'Dating');

    await enableChatbot(pageAdam);
    await enableChatbot(pageOther);

    const adamId = await getCurrentUserId(pageAdam);
    const eveId = await getCurrentUserId(pageOther);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();

    // Dating talks are always adult-flagged — both sides need real AGE_VERIFICATION_THRESHOLD
    // (3) votes before either can receive the other's talk.
    await serverVouchAgeVerified(pageOther, eveId, 3);
    await serverVouchAgeVerified(pageAdam, adamId, 3);

    await broadcastFromGlobalChatroom(pageAdam);
    await afterSync();

    await expect.poll(() => hasConversationWith(pageOther, adamId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageAdam, eveId), { timeout: 30_000 }).toBe(true);
  });

  test('Chris, a man, does NOT match Adam\'s talk once the "men" branch is removed (accepts only women/non-binary people)', async () => {
    test.setTimeout(120_000);
    const adam = await bootstrapUser(browserAdam, 'Adam', 'AdamDatingMultiNeg');
    contextAdam = adam.context;
    pageAdam = adam.page;
    const chris = await bootstrapUser(browserOther, 'Chris', 'ChrisDatingMultiNeg');
    contextOther = chris.context;
    pageOther = chris.page;

    // Adam: remove the "men" branch (q_1 + its confirmation leaf) — same "remove a route node"
    // affordance every other route-editor spec uses (`.route-remove-question-btn`).
    await pickDatingTemplate(pageAdam);
    await pageAdam.locator('.route-remove-question-btn[data-qid="q_1"]').click();
    await pageAdam.locator('#talk-send-to-chatroom').setChecked(false);
    await expect(pageAdam.locator('#talk-validation-errors')).not.toBeVisible();
    await submitTalkEditorAndWaitForOut(pageAdam, 'Dating');

    // Chris: a man — template as-is (default "myGender" is "men").
    await pickDatingTemplate(pageOther);
    await pageOther.locator('#talk-send-to-chatroom').setChecked(false);
    await expect(pageOther.locator('#talk-validation-errors')).not.toBeVisible();
    await submitTalkEditorAndWaitForOut(pageOther, 'Dating');

    await enableChatbot(pageAdam);
    await enableChatbot(pageOther);

    const adamId = await getCurrentUserId(pageAdam);
    const chrisId = await getCurrentUserId(pageOther);
    expect(adamId).toBeTruthy();
    expect(chrisId).toBeTruthy();

    await serverVouchAgeVerified(pageOther, chrisId, 3);
    await serverVouchAgeVerified(pageAdam, adamId, 3);

    await broadcastFromGlobalChatroom(pageAdam);
    await afterSync();

    // Give it the same window a confident-incompatible case gets elsewhere in this suite, then
    // confirm no conversation formed — Chris's gender isn't in Adam's (now 2-branch) accepted set.
    await pageOther.waitForTimeout(4000);
    await afterSync();
    expect(await hasConversationWith(pageOther, adamId)).toBe(false);
    expect(await hasConversationWith(pageAdam, chrisId)).toBe(false);
  });
});
