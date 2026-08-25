/**
 * §DD: the Dating template's new `ageRange` built-in comparator (`ageRangeMutuallyAcceptable`,
 * built-in-comparisons.ts) proved end to end, real cross-browser — the one genuinely new
 * matching mechanism the 4 talk templates introduce (Buy/Sell, Taxi, and Job Seeker all reuse
 * the already-proven Pair-tag + chatbot cross-talk mechanism, 89-buy-sell-chatbot-cross-talk-
 * match.spec.ts / the taxi spec, so they don't get their own match spec — only their template
 * prefill is checked, 83-talk-template-picker.spec.ts).
 *
 * Unlike `intervalsOverlap` (priceRange/timeFrame, both sides offer a RANGE), `ageRange` compares
 * a single declared fact (each side's own age) against the OTHER side's acceptable range, checked
 * mutually — see `ageRangeMutuallyAcceptable`'s doc comment. Two independent pairs, same shape as
 * 87-price-overlap-buy-sell-match.spec.ts's two-deals-in-one-test structure: a MATCH pair (ages
 * fall within each other's acceptable range, not identical ages — real math, not string
 * equality) and a MISMATCH pair (one side's age falls outside the other's range) under a
 * different title, proving the negative in the same run instead of a separate timing-based wait.
 *
 * Built via raw editor interaction (`fillPairTagQuestion` + the new `.builtin-agerange-*` fields,
 * talk-editor-form-helpers.ts) rather than a script-supplied payload — same "every e2e talk goes
 * through the real Talk Editor" convention this whole suite follows.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterSync, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, fillPairTagQuestion, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { serverVouchAgeVerified } from '../../helpers/reputation-e2e-helpers';

async function createDatingTalk(
  page: Page,
  title: string,
  ageQuestionText: string,
  myAge: number,
  acceptMin: number,
  acceptMax: number,
  tag: string,
  counterpartTag: string,
): Promise<void> {
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');

  await page.click('#add-question-btn');
  await fillPairTagQuestion(page, 0, tag, counterpartTag, 'q_1');
  const q2 = page.locator('.question-item[data-question-index="1"]');
  await q2.locator('.question-text').fill(ageQuestionText);
  // Advanced fields live inside a collapsed <details> by default (progressive disclosure,
  // talk-editor-form-helpers.ts) — open it before touching anything inside.
  await q2.locator('.question-advanced').evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
  await q2.locator('.builtin-kind').selectOption('ageRange');
  await afterAction();
  await q2.locator('.builtin-agerange-age').fill(String(myAge));
  await q2.locator('.builtin-agerange-min').fill(String(acceptMin));
  await q2.locator('.builtin-agerange-max').fill(String(acceptMax));

  // §DD: the ageRange kind force-checks-and-disables #talk-is-adult live (the UI half of the
  // dating-category adult lock) — assert it here rather than trusting it silently happened.
  await expect(page.locator('#talk-is-adult')).toBeChecked();
  await expect(page.locator('#talk-is-adult')).toBeDisabled();

  // "Send to Chatroom" defaults checked, which would auto-broadcast right here — before the
  // counterpart has had a chance to record their own typed preference. Delivery is owned
  // entirely by the explicit broadcast call below instead.
  await page.locator('#talk-send-to-chatroom').setChecked(false);

  await submitTalkEditorAndWaitForOut(page, title);
  await expect(page.locator('#talk-validation-errors')).not.toBeVisible();
}

async function broadcastTalk(page: Page): Promise<void> {
  await broadcastFromGlobalChatroom(page);
  await afterSync();
}

async function enableChatbot(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  await page.click('.nav-btn[data-view="talks"]');
  await waitForTabActive(page, 'talks');
}

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

async function conversationPartnerIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    return Object.values(conversations)
      .filter((c: any) => c && c.supportChannel !== true)
      .map((c: any) => String(c.otherUserId || ''))
      .filter(Boolean);
  });
}

async function hasConversationWith(page: Page, otherUserId: string): Promise<boolean> {
  return (await conversationPartnerIds(page)).includes(otherUserId);
}

test.describe('Dating template: mutual ageRange matching (§DD)', () => {
  let browserAdam: Browser;
  let browserEve: Browser;
  let contextAdam: BrowserContext;
  let contextEve: BrowserContext;
  let pageAdam: Page;
  let pageEve: Page;

  test.beforeEach(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    const mk = (x: number) => ({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=640,900', '--force-device-scale-factor=1'],
    });
    [browserAdam, browserEve] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(650))]);
  });

  test.afterEach(async () => {
    for (const page of [pageAdam, pageEve]) {
      await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    }
    await Promise.all([contextAdam?.close?.().catch(() => {}), contextEve?.close?.().catch(() => {})]);
    await Promise.all([browserAdam?.close().catch(() => {}), browserEve?.close().catch(() => {})]);
    await clearGunForStage2Spec();
  });

  test('mutually-acceptable ages match; one side outside the other\'s range does not', async () => {
    test.setTimeout(120_000);
    const runId = Date.now();
    const matchTitle = `Dating Match ${runId}`;
    const mismatchTitle = `Dating Mismatch ${runId}`;
    // Distinct question text per pair, not just distinct titles — non-tag talk ids are
    // content-hashed from questions alone (src/shared/cid.ts, title is NOT part of the
    // identity), so identically-worded questions across the two pairs would silently dedupe
    // Adam's second talk into his first in his own local talk store.
    const matchAgeQuestion = 'Age range (compatible pair)';
    const mismatchAgeQuestion = 'Age range (incompatible pair)';

    // Both bootstrap (join the shared Global room) before either creates a talk — avoids the
    // late-joiner catch-up race the other builtIn specs' file headers document (§BB).
    const adam = await bootstrapUser(browserAdam, 'Adam', 'AdamDating');
    contextAdam = adam.context;
    pageAdam = adam.page;
    const eve = await bootstrapUser(browserEve, 'Eve', 'EveDating');
    contextEve = eve.context;
    pageEve = eve.page;

    // Match pair: Adam is 30, accepts 25-35; Eve is 28, accepts 26-40. Neither age is
    // identical to the other's range bounds — real point-in-mutual-range math, not exact-text
    // matching wearing a numeric disguise. Adam accepts Eve (28 in [25,35]); Eve accepts Adam
    // (30 in [26,40]).
    await createDatingTalk(pageAdam, matchTitle, matchAgeQuestion, 30, 25, 35, 'seeking women', 'seeking men');
    await createDatingTalk(pageEve, matchTitle, matchAgeQuestion, 28, 26, 40, 'seeking men', 'seeking women');

    // Mismatch pair, different title AND question text (separate content-hash id + typed-
    // preference scope key): Adam is 50, accepts 45-60 — Eve's declared age (28, same
    // person/range as above but under this pair's own scope) falls outside Adam's acceptable
    // range, so neither direction accepts.
    await createDatingTalk(pageAdam, mismatchTitle, mismatchAgeQuestion, 50, 45, 60, 'seeking women', 'seeking men');
    await createDatingTalk(pageEve, mismatchTitle, mismatchAgeQuestion, 28, 26, 40, 'seeking men', 'seeking women');

    await enableChatbot(pageAdam);
    await enableChatbot(pageEve);

    const adamId = await getCurrentUserId(pageAdam);
    const eveId = await getCurrentUserId(pageEve);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();

    // Dating talks are always adult-flagged (§DD's forced+locked isAdult) — the intake gate
    // rejects an adult-flagged talk delivered to a not-yet-age-verified receiver
    // (intakeFilterRejectReasons, talk-intake-filters.ts), so both sides need real
    // AGE_VERIFICATION_THRESHOLD (3) votes before either can receive the other's talk.
    await serverVouchAgeVerified(pageEve, eveId, 3);
    await serverVouchAgeVerified(pageAdam, adamId, 3);

    // Only Adam explicitly broadcasts — Eve's talks exist purely to seed her own typed-
    // preference store, same "each stranger creates their own talk before ever broadcasting or
    // meeting" shape 87/89/the taxi spec already use.
    await broadcastTalk(pageAdam);
    await afterAction();

    await expect
      .poll(() => hasConversationWith(pageAdam, eveId), { timeout: 30_000, message: 'Adam: no matched conversation with Eve on the compatible age pair' })
      .toBe(true);
    await expect
      .poll(() => hasConversationWith(pageEve, adamId), { timeout: 30_000 })
      .toBe(true);

    // The mismatch pair must not have ALSO produced a second conversation — exactly one
    // conversation per user pair regardless of how many talk-level matches/mismatches exist
    // between them (createConversation keys on the user pair, same as 87/89 already prove).
    expect(await conversationPartnerIds(pageAdam)).toEqual([eveId]);
    expect(await conversationPartnerIds(pageEve)).toEqual([adamId]);
  });
});
