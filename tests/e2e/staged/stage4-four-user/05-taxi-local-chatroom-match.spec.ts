/**
 * Taxi driver ↔ passenger matching in a LOCAL (city-level) chatroom — docs/TODO.md §GG.
 *
 * Adam and Eve are both taxi drivers (role 'offer'); Bob and Alice are both passengers (role
 * 'request'). All four join the same city-level chatroom (San Diego) instead of Global, then
 * broadcast talks they already created — matching happens entirely via the chatbot's
 * exact-question-text auto-reply (src/shared/exact-chatbot-memory.ts), same mechanic as
 * 04-dealmaker-chatbot-match.spec.ts, just with taxi wording and a driver/passenger pairing
 * instead of buyer/seller.
 *
 * Adam and Alice share byte-identical question wording (including a "licensed and experienced
 * driver" criterion and a payment-methods criterion) so the chatbot auto-matches them; Eve and
 * Bob each use their own distinctly-reworded criteria, so neither matches Adam/Alice or each
 * other — mirroring the existing dealmaker spec's Bob/Alice "never match anyone" pattern.
 *
 * Two things in Bernard's original scenario don't exist as real app features and are
 * deliberately NOT built here (see docs/TODO.md §GG's analysis for the reasoning):
 *   - "Adam gets Alice's precise location to pick her up" — there is no
 *     share-precise-location-on-match feature (explicitly deferred/unscoped, see §X's
 *     completion note in docs/completed.md and the "Future / low priority" list in TODO.md).
 *     Simulated here as an ordinary DM text message Alice sends after the match forms.
 *   - "Alice makes sure Adam is a licensed, experienced driver" — there is no
 *     verification/vouch system beyond the single-purpose age-verify boolean. Modeled as an
 *     ordinary self-declared flow criterion that's part of the SAME matching chain (both sides
 *     self-answer "yes"), so it's naturally recorded talk data, not a separate trust system.
 *
 * "No financial transaction in the app" / "Adam accepts popular credit card payment and cash":
 * the app has no payment UI to begin with, and the payment-methods criterion's descriptive text
 * is confirmed NOT to trip §CC's mandatory financial-data guard (financial-data-guard.ts only
 * flags actual Luhn-valid, network-prefixed card numbers, never brand-name mentions).
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, afterAction, delay, headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser, waitForTabActive } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';

const LOCAL_ROOM_ID = 'san-diego';

type RideQuestion = { text: string; matchAnswerText: string; otherAnswerText: string };

// Adam (driver) and Alice (passenger) share byte-identical wording — required for the chatbot's
// exact-question-text memory to connect two independently-authored talks (see
// exact-chatbot-memory.ts's normalizeText, case-sensitive after trim).
const ADAM_ALICE_QUESTIONS: RideQuestion[] = [
  { text: 'Do you need a ride right now?', matchAnswerText: 'Yes, right now.', otherAnswerText: 'No, later today.' },
  { text: 'Is the pickup within the Downtown zone?', matchAnswerText: 'Yes, Downtown zone.', otherAnswerText: 'No, a different zone.' },
  { text: 'Are you a licensed and experienced taxi driver?', matchAnswerText: 'Yes, licensed and experienced.', otherAnswerText: 'No, not licensed.' },
  { text: 'Do you accept major credit cards and cash?', matchAnswerText: 'Yes, cards and cash.', otherAnswerText: 'No, cash only.' },
];

// Eve (driver) — every question reworded vs. Adam/Alice AND vs. Bob below, so no one's exact-
// chatbot memory ever resolves her incoming talks. Eve should never match anyone.
const EVE_QUESTIONS: RideQuestion[] = [
  { text: 'Are you looking for a ride within the next hour?', matchAnswerText: 'Yes, within the hour.', otherAnswerText: 'No, some other time.' },
  { text: 'Is the pickup located in the Harbor district?', matchAnswerText: 'Yes, Harbor district.', otherAnswerText: 'No, a different district.' },
  { text: 'Do you hold a valid taxi operator permit with 5+ years on the road?', matchAnswerText: 'Yes, permitted and 5+ years.', otherAnswerText: 'No, not permitted.' },
  { text: 'Is a mobile payment app acceptable to you?', matchAnswerText: 'Yes, mobile payment works.', otherAnswerText: 'No, not mobile payment.' },
];

// Bob (passenger) — reworded again, distinct from Adam/Alice AND from Eve, so Eve and Bob never
// cross-match each other either, even though both are "taxi ride" deals in the same room.
const BOB_QUESTIONS: RideQuestion[] = [
  { text: 'Do you want a taxi within the next 30 minutes?', matchAnswerText: 'Yes, within 30 minutes.', otherAnswerText: 'No, later.' },
  { text: 'Is your pickup spot near the Train Station?', matchAnswerText: 'Yes, near Train Station.', otherAnswerText: 'No, somewhere else.' },
  { text: 'Do you require the driver to show a taxi license on request?', matchAnswerText: 'Yes, must show license.', otherAnswerText: 'No, not required.' },
  { text: 'Will you pay only with exact cash?', matchAnswerText: 'Yes, exact cash only.', otherAnswerText: 'No, other methods OK.' },
];

async function createRideTalk(
  page: Page,
  title: string,
  questions: RideQuestion[],
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
  // Regression guard for §CC: the payment-methods criterion's descriptive text ("cards and
  // cash", "cash only", ...) must never trip the mandatory financial-data block.
  await expect(page.locator('#talk-validation-errors')).not.toBeVisible();
}

/** Enters the San Diego city room (not Global) — the "local chatroom" from the scenario. */
async function ensureInLocalRoom(page: Page): Promise<void> {
  await page.click('.nav-btn[data-view="chatrooms"]');
  await waitForTabActive(page, 'chatrooms');
  const inDetail = await page.locator('#chatroom-members-list').isVisible().catch(() => false);
  if (inDetail) {
    await page.click('#back-to-chatrooms').catch(() => {});
    await afterSync();
  }
  await page.locator(`.chatroom-item[data-chatroom-id="${LOCAL_ROOM_ID}"]`).first().click();
  await afterSync();
}

async function meetAndBroadcastLocally(page: Page): Promise<void> {
  await ensureInLocalRoom(page);
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  // Settings navigation exits the room detail view — re-enter before broadcasting so
  // clickBroadcastUntilBulkAck's own "not already in a room detail" fallback (hardcoded to
  // Global) never fires.
  await ensureInLocalRoom(page);
  await clickBroadcastUntilBulkAck(page);
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

async function getConversationIdWith(page: Page, otherUserId: string): Promise<string | null> {
  return page.evaluate((id: string) => {
    const conversations = JSON.parse(localStorage.getItem('myConversations') || '{}');
    const entry = Object.entries(conversations).find(([, c]: any) => c?.otherUserId === id);
    return entry ? entry[0] : null;
  }, otherUserId);
}

/** Simulates "Adam gets Alice's precise location to pick her up" as a plain DM message — see
 *  file header: there is no real precise-location-reveal-on-match feature to call here. */
async function openConversationAndSendMessage(page: Page, otherUserId: string, message: string): Promise<void> {
  const conversationId = await getConversationIdWith(page, otherUserId);
  expect(conversationId).toBeTruthy();
  await page.evaluate((cid: string) => {
    (window as any).__iinpublic_app?.getApp?.()?.uiManager?.showConversationDetail?.(cid);
  }, conversationId);
  await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 20_000 });
  const input = page.locator('#conversation-message-input');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(message);
  await afterAction();
  await page.click('#send-conversation-message');
  await afterSync();
}

async function expectMessageVisible(page: Page, message: string): Promise<void> {
  const needle = message.split(' ').slice(0, 3).join(' ');
  await expect(page.getByText(needle, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

/** Adam's own recorded self-answer to the shared "licensed and experienced" criterion — the
 *  stand-in for "Alice makes sure Adam is a licensed, experienced driver" (see file header). */
async function hasLicensedExperiencedSelfAnswer(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    return Object.values(talks).some((t: any) => {
      const questions = t?.fullTalk?.questions || t?.questions || [];
      return questions.some(
        (q: any) =>
          q.text === 'Are you a licensed and experienced taxi driver?' &&
          (q.answers || []).some((a: any) => a.text === 'Yes, licensed and experienced.'),
      );
    });
  });
}

type FourBrowsers = { adam: Browser; eve: Browser; bob: Browser; alice: Browser };

async function launchFourBrowsers(): Promise<FourBrowsers> {
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

async function shutdownFourBrowsers(b: FourBrowsers | undefined): Promise<void> {
  await b?.adam?.close().catch(() => {});
  await b?.eve?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
  await b?.alice?.close().catch(() => {});
}

test.describe('Taxi driver ↔ passenger matching in a local chatroom (§GG)', () => {
  let browsers: FourBrowsers;
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

  test('Adam+Alice auto-match in the local room; Eve+Bob never match anyone', async () => {
    const adam = await bootstrapUser(browsers.adam, 'Adam', 'Adam');
    contextAdam = adam.context;
    pageAdam = adam.page;
    await createRideTalk(pageAdam, 'Available for rides - Downtown', ADAM_ALICE_QUESTIONS, 'offer');

    const eve = await bootstrapUser(browsers.eve, 'Eve', 'Eve');
    contextEve = eve.context;
    pageEve = eve.page;
    await createRideTalk(pageEve, 'Available for rides - Harbor', EVE_QUESTIONS, 'offer');

    const bob = await bootstrapUser(browsers.bob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await createRideTalk(pageBob, 'Looking for a taxi - Train Station', BOB_QUESTIONS, 'request');

    const alice = await bootstrapUser(browsers.alice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await createRideTalk(pageAlice, 'Looking for a taxi - Downtown', ADAM_ALICE_QUESTIONS, 'request');

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

    // === All 4 join the SAME local (San Diego) chatroom — not Global — and broadcast the
    // talks they already created. From here, matching happens with zero manual clicks. ===
    for (const page of [pageAdam, pageEve, pageBob, pageAlice]) {
      await meetAndBroadcastLocally(page);
    }

    await expect.poll(() => hasConversationWith(pageAdam!, aliceId), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => hasConversationWith(pageAlice!, adamId), { timeout: 30_000 }).toBe(true);

    expect(await hasConversationWith(pageAdam!, eveId)).toBe(false);
    expect(await hasConversationWith(pageAdam!, bobId)).toBe(false);
    expect(await hasConversationWith(pageAlice!, eveId)).toBe(false);
    expect(await hasConversationWith(pageAlice!, bobId)).toBe(false);
    expect(await conversationPartnerIds(pageEve!)).toEqual([]);
    expect(await conversationPartnerIds(pageBob!)).toEqual([]);

    // "Alice makes sure that Adam is a licensed, experienced taxi driver" — the shared
    // criterion both sides self-answered is real recorded talk data on Adam's own talk.
    expect(await hasLicensedExperiencedSelfAnswer(pageAdam!)).toBe(true);

    // "Adam gets Alice's precise location to pick her up" — simulated as a plain DM message
    // (see file header for why this isn't a structured location-reveal feature).
    const pickupMessage = 'I am at 123 Main Street, Downtown San Diego — ready for pickup.';
    await openConversationAndSendMessage(pageAlice!, adamId, pickupMessage);
    await expectMessageVisible(pageAlice!, pickupMessage);
    await openConversationAndSendMessage(pageAdam!, aliceId, 'On my way, be there in 5 minutes.');
    await expectMessageVisible(pageAdam!, pickupMessage);
  });
});
