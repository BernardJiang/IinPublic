/**
 * Dealmaker: four strangers each create a flow talk describing their side of a used-notebook
 * deal before ever meeting, then broadcast into Global — matching happens entirely via the
 * chatbot's exact-question-text auto-reply, with no manual answer clicks anywhere.
 *
 * Talks also declare a two-sided Talk.role ('request' = buyer, 'offer' = seller) — see
 * talk-engine.ts's checkIfMatch and exact-chatbot-memory.ts's findAutoAnswer. Without this,
 * matching is pure text-equality: two BUYERS with identical wording would "match" each other
 * just as readily as a buyer and a seller. The second test below proves that specific case is
 * now vetoed.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, delay, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { broadcastFromGlobalChatroom, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

type DealQuestion = { text: string; matchAnswerText: string; otherAnswerText: string };

// Adam (buyer) and Eve (seller) share byte-identical question/answer wording. Matching is
// keyed on exact question text (src/shared/exact-chatbot-memory.ts's normalizeText is
// case-sensitive after trim), so this is what lets the chatbot auto-resolve a total stranger's
// incoming talk from each user's OWN self-answers, recorded when they created their own talk.
const ADAM_EVE_QUESTIONS: DealQuestion[] = [
  { text: 'Is the notebook used, not new?', matchAnswerText: 'Yes, it is used.', otherAnswerText: 'No, it is new.' },
  { text: 'Is it exactly one unit?', matchAnswerText: 'Yes, one unit.', otherAnswerText: 'No, multiple units.' },
  { text: 'Is the notebook model a ThinkPad X1 Carbon?', matchAnswerText: 'Yes, ThinkPad X1 Carbon.', otherAnswerText: 'No, a different model.' },
  { text: 'Is the price in the $300 to $500 range?', matchAnswerText: 'Yes, $300 to $500.', otherAnswerText: 'No, outside that range.' },
  { text: 'Can the deal happen at Downtown Cafe?', matchAnswerText: 'Yes, Downtown Cafe works.', otherAnswerText: 'No, a different location.' },
  { text: 'Can the deal happen this weekend?', matchAnswerText: 'Yes, this weekend works.', otherAnswerText: 'No, a different time frame.' },
];

// Bob (buyer) — every question deliberately reworded vs. Adam/Eve AND vs. Alice below, so no
// one's exact-chatbot memory ever resolves it: Bob should never match anyone.
const BOB_QUESTIONS: DealQuestion[] = [
  { text: 'Is the notebook pre-owned rather than new?', matchAnswerText: 'Yes, pre-owned.', otherAnswerText: 'No, brand new.' },
  { text: 'Is it a single unit only?', matchAnswerText: 'Yes, a single unit.', otherAnswerText: 'No, more than one.' },
  { text: 'Is the notebook model a MacBook Air M2?', matchAnswerText: 'Yes, MacBook Air M2.', otherAnswerText: 'No, a different model.' },
  { text: 'Is the price in the $700 to $900 range?', matchAnswerText: 'Yes, $700 to $900.', otherAnswerText: 'No, outside that range.' },
  { text: 'Can the deal happen at City Library?', matchAnswerText: 'Yes, City Library works.', otherAnswerText: 'No, a different location.' },
  { text: 'Can the deal happen next week?', matchAnswerText: 'Yes, next week works.', otherAnswerText: 'No, a different time frame.' },
];

// Alice (seller) — reworded again, distinct from Adam/Eve AND from Bob, so Bob and Alice never
// cross-match each other either, even though both are "used notebook" deals in the same room.
const ALICE_QUESTIONS: DealQuestion[] = [
  { text: 'Is the notebook second-hand rather than brand new?', matchAnswerText: 'Yes, second-hand.', otherAnswerText: 'No, brand new.' },
  { text: 'Is it a lone unit for sale?', matchAnswerText: 'Yes, a lone unit.', otherAnswerText: 'No, more than one.' },
  { text: 'Is the notebook model a Dell XPS 13?', matchAnswerText: 'Yes, Dell XPS 13.', otherAnswerText: 'No, a different model.' },
  { text: 'Is the price in the $600 to $800 range?', matchAnswerText: 'Yes, $600 to $800.', otherAnswerText: 'No, outside that range.' },
  { text: 'Can the deal happen at Central Park?', matchAnswerText: 'Yes, Central Park works.', otherAnswerText: 'No, a different location.' },
  { text: 'Can the deal happen next month?', matchAnswerText: 'Yes, next month works.', otherAnswerText: 'No, a different time frame.' },
];

/**
 * Build a flow talk from a linear chain of yes/no criteria questions. The app only lets answer
 * index 0 of a flow question carry isMatch/nextQuestionId (TalkAutofix.fix collapses every
 * other answer to an implicit ignore terminal, src/shared/talk-engine.ts) — so the matching
 * option must always be answer 0, and picking a non-ignore "next" for it is also what checks
 * that answer's self-answer radio (talk-editor-form-helpers.ts), recording it as this user's
 * own preference for that exact question text.
 */
async function createDealTalk(
  page: Page,
  title: string,
  questions: DealQuestion[],
  role: 'offer' | 'request',
): Promise<void> {
  await page.click('#create-talk-btn');
  await page.waitForSelector('#talk-editor-form');
  await page.fill('#talk-title', title);
  await page.selectOption('#talk-type', 'flow');
  await page.selectOption('#talk-role', role);

  for (let i = 1; i < questions.length; i++) {
    await page.click('#add-question-btn');
    await afterAction();
  }

  for (let i = 0; i < questions.length; i++) {
    const { text, matchAnswerText, otherAnswerText } = questions[i];
    const isLast = i === questions.length - 1;
    const q = page.locator('.question-item').nth(i);
    await q.locator('.question-text').fill(text);
    await q.locator('.answer-item').nth(0).locator('.answer-text').fill(matchAnswerText);
    await q.locator('.answer-item').nth(0).locator('.answer-next').selectOption(isLast ? 'noticed' : `q_${i + 1}`);
    await q.locator('.answer-item').nth(1).locator('.answer-text').fill(otherAnswerText);
    await q.locator('.answer-item').nth(1).locator('.answer-next').selectOption('ignore');
  }

  await submitTalkEditorAndWaitForOut(page, title);
}

/** Join Global, turn on the chatbot, then broadcast the talk already created earlier. */
async function meetAndBroadcast(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  await afterSync();
  const inDetail = await page.locator('#chatroom-members-list').isVisible().catch(() => false);
  if (!inDetail) {
    await page.locator('.chatroom-item:has-text("Global")').first().click();
    await afterSync();
  }

  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();

  await broadcastFromGlobalChatroom(page);
}

async function getCurrentUserId(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.currentUser?.id ?? '');
}

/** Non-support conversation partner ids currently recorded on this user's device. */
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

type DealmakerBrowsers = { adam: Browser; eve: Browser; bob: Browser; alice: Browser };

async function launchFourBrowsers(): Promise<DealmakerBrowsers> {
  const mk = (x: number, y: number) => ({
    headless,
    slowMo: headless ? 0 : delay(50, 120),
    args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},${y}`, '--window-size=640,900', '--force-device-scale-factor=1'],
  });
  const [adam, eve, bob, alice] = await Promise.all([
    chromium.launch(mk(0, 0)),
    chromium.launch(mk(640, 0)),
    chromium.launch(mk(0, 940)),
    chromium.launch(mk(640, 940)),
  ]);
  return { adam, eve, bob, alice };
}

async function shutdownFourBrowsers(b: DealmakerBrowsers | undefined): Promise<void> {
  await b?.adam?.close().catch(() => {});
  await b?.eve?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
  await b?.alice?.close().catch(() => {});
}

test.describe('Dealmaker: chatbot auto-matches strangers who broadcast compatible flow talks', () => {
  let browsers: DealmakerBrowsers;
  let contextAdam: BrowserContext | undefined;
  let contextEve: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let contextAlice: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageEve: Page | undefined;
  let pageBob: Page | undefined;
  let pageAlice: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
    browsers = await launchFourBrowsers();
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    };
    await Promise.all([cleanup(pageAdam), cleanup(pageEve), cleanup(pageBob), cleanup(pageAlice)]);
    await Promise.all([
      pageAdam?.close().catch(() => {}),
      pageEve?.close().catch(() => {}),
      pageBob?.close().catch(() => {}),
      pageAlice?.close().catch(() => {}),
    ]);
    await Promise.all([
      contextAdam?.close().catch(() => {}),
      contextEve?.close().catch(() => {}),
      contextBob?.close().catch(() => {}),
      contextAlice?.close().catch(() => {}),
    ]);
    await shutdownFourBrowsers(browsers);
    await clearGunForStage4Spec();
  });

  test('Adam+Eve auto-match on compatible criteria; Bob+Alice never match anyone', async () => {
    // === Each of the 4 users creates their own talk BEFORE joining any chatroom or knowing
    // about anyone else — the point of this test is that the chatbot resolves the match
    // purely from each user's own self-answers, with no manual answering and no prior contact.
    const adam = await bootstrapUser(browsers.adam, 'Adam', 'Adam');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await createDealTalk(pageAdam, 'Buy Used Notebook - Deal Terms', ADAM_EVE_QUESTIONS, 'request');

    const eve = await bootstrapUser(browsers.eve, 'Eve', 'Eve');
    contextEve = eve.context;
    pageEve = eve.page;
    await createDealTalk(pageEve, 'Sell Used Notebook - Deal Terms', ADAM_EVE_QUESTIONS, 'offer');

    const bob = await bootstrapUser(browsers.bob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await createDealTalk(pageBob, 'Buy Used Notebook - MacBook Deal', BOB_QUESTIONS, 'request');

    const alice = await bootstrapUser(browsers.alice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await createDealTalk(pageAlice, 'Sell Used Notebook - Dell Deal', ALICE_QUESTIONS, 'offer');

    const [adamId, eveId, bobId, aliceId] = await Promise.all([
      getCurrentUserId(pageAdam),
      getCurrentUserId(pageEve),
      getCurrentUserId(pageBob),
      getCurrentUserId(pageAlice),
    ]);
    expect(adamId).toBeTruthy();
    expect(eveId).toBeTruthy();
    expect(bobId).toBeTruthy();
    expect(aliceId).toBeTruthy();

    // === Now they "meet": all 4 join Global, enable the chatbot, and broadcast the talks
    // they already created. From here, matching happens with zero manual clicks. ===
    for (const page of [pageAdam, pageEve, pageBob, pageAlice]) {
      await meetAndBroadcast(page);
    }

    // Adam and Eve's talks are textually identical and each self-answered "yes" on every
    // question when creating their own talk — the chatbot should auto-match them.
    await expect.poll(() => hasConversationWith(pageAdam!, eveId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageEve!, adamId), { timeout: 30_000 }).toBe(true);

    // Bob and Alice's talks never share exact question wording with anyone (including each
    // other), so nobody's chatbot can auto-resolve them — no deal forms for either of them.
    expect(await hasConversationWith(pageAdam!, bobId)).toBe(false);
    expect(await hasConversationWith(pageAdam!, aliceId)).toBe(false);
    expect(await hasConversationWith(pageEve!, bobId)).toBe(false);
    expect(await hasConversationWith(pageEve!, aliceId)).toBe(false);
    expect(await conversationPartnerIds(pageBob!)).toEqual([]);
    expect(await conversationPartnerIds(pageAlice!)).toEqual([]);
  });

  test('two buyers with byte-identical criteria do NOT match — same role is vetoed even when text matches exactly', async () => {
    // Regression for the bug this whole role feature exists to fix: before Talk.role existed,
    // two talks with identical question/answer wording matched regardless of who was on which
    // side of the deal — the chatbot's exact-text memory can't tell "buyer" from "seller" on
    // its own. Reuses the SAME wording as the positive test above (ADAM_EVE_QUESTIONS), but
    // both sides declare 'request' (buyer) — proving that text equality alone is no longer
    // enough to produce a match.
    await clearGunForStage4Spec();
    const buyer1 = await bootstrapUser(browsers.adam, 'Buyer1', 'Buyer1');
    const buyer2 = await bootstrapUser(browsers.bob, 'Buyer2', 'Buyer2');
    try {
      await createDealTalk(buyer1.page, 'Buy Used Notebook - Deal Terms', ADAM_EVE_QUESTIONS, 'request');
      await createDealTalk(buyer2.page, 'Buy Used Notebook - Deal Terms Too', ADAM_EVE_QUESTIONS, 'request');

      const buyer1Id = await getCurrentUserId(buyer1.page);
      const buyer2Id = await getCurrentUserId(buyer2.page);
      expect(buyer1Id).toBeTruthy();
      expect(buyer2Id).toBeTruthy();

      await meetAndBroadcast(buyer1.page);
      await meetAndBroadcast(buyer2.page);

      // Actively watch for the bug condition for as long as the positive test's own timeout
      // budget, rather than a single instant check or a blind sleep — if checkIfMatch's
      // same-role veto regressed, this would catch it turning true within the window instead
      // of silently passing because we didn't wait long enough to see it.
      let wronglyMatched = false;
      try {
        await expect.poll(() => hasConversationWith(buyer1.page, buyer2Id), { timeout: 8_000, intervals: [300] }).toBe(true);
        wronglyMatched = true;
      } catch {
        wronglyMatched = false;
      }
      expect(wronglyMatched).toBe(false);
      expect(await hasConversationWith(buyer2.page, buyer1Id)).toBe(false);
    } finally {
      await buyer1.page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await buyer2.page.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
      await buyer1.context.close().catch(() => {});
      await buyer2.context.close().catch(() => {});
      await clearGunForStage4Spec();
    }
  });
});
