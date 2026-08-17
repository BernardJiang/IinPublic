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
import { bootstrapUser, pinStableE2eLocation, waitForTabActive } from '../../helpers/talks-matching-flow';
import { clickBroadcastUntilBulkAck, submitTalkEditorAndWaitForOut } from '../../helpers/talk-demo-ui';
import { openSettingsSection, SETTINGS_SECTION } from '../../helpers/settings-nav';
import { selectTalkEditorType } from '../../helpers/talk-editor-e2e';

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

async function prepareLocalBroadcast(page: Page): Promise<void> {
  await ensureInLocalRoom(page);
  await page.click('.nav-btn[data-view="settings"]');
  await openSettingsSection(page, SETTINGS_SECTION.talkBehavior);
  const chatbotCheckbox = page.locator('#settings-chatbot-enabled');
  if (!(await chatbotCheckbox.isChecked())) await chatbotCheckbox.click();
  // Settings navigation exits the room detail view — re-enter before broadcasting so
  // clickBroadcastUntilBulkAck's own "not already in a room detail" fallback (hardcoded to
  // Global) never fires.
  await ensureInLocalRoom(page);
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
    const localPages = [pageAdam, pageEve, pageBob, pageAlice];
    // Establish the complete local-room audience before the first broadcast. Moving and
    // broadcasting one user at a time made Adam's audience check race at zero peers.
    await Promise.all(localPages.map((page) => prepareLocalBroadcast(page)));
    for (const page of localPages) await clickBroadcastUntilBulkAck(page);

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

/** Whether the given page's own created talk with this title has been auto-disabled — the
 *  "busy, no longer accepting new match inquiries" state (`setTalkDisabled`, `app.ts`). */
async function isOwnTalkDisabled(page: Page, title: string): Promise<boolean> {
  return page.evaluate((needle: string) => {
    const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
    return Object.values(talks).some((t: any) => t?.title === needle && t?.disabled === true);
  }, title);
}

type FiveBrowsers = { adam: Browser; eve: Browser; frank: Browser; bob: Browser; alice: Browser };

async function launchFiveBrowsers(): Promise<FiveBrowsers> {
  const mk = (x: number, y: number) => ({
    headless,
    slowMo: headless ? 0 : delay(50, 120),
    args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},${y}`, '--window-size=560,820', '--force-device-scale-factor=1'],
  });
  const [adam, eve, frank, bob, alice] = await Promise.all([
    chromium.launch(mk(0, 0)),
    chromium.launch(mk(560, 0)),
    chromium.launch(mk(1120, 0)),
    chromium.launch(mk(0, 860)),
    chromium.launch(mk(560, 860)),
  ]);
  return { adam, eve, frank, bob, alice };
}

async function shutdownFiveBrowsers(b: FiveBrowsers | undefined): Promise<void> {
  await b?.adam?.close().catch(() => {});
  await b?.eve?.close().catch(() => {});
  await b?.frank?.close().catch(() => {});
  await b?.bob?.close().catch(() => {});
  await b?.alice?.close().catch(() => {});
}

/**
 * §GG follow-up: 3 drivers announce identically-worded offers into the local room, 2 passengers
 * send identically-worded requests — the chatbot must pick each passenger's CLOSEST available
 * driver (real distance via `Talk.authorLocation`, see `src/shared/closest-match.ts`), and once a
 * driver has matched, a further inquiry to that same driver must be rejected rather than forming
 * a second conversation (`isExclusiveMarketplaceTalk` guard in `app.ts`'s
 * `handleMeshTalkResponse`).
 *
 * Adam is pinned essentially on top of both passengers, Eve a few miles out, Frank ~20 miles out
 * — so both Alice and Bob independently rank Adam as nearest and race to match him. Whichever of
 * them the mesh delivers first wins; the other must be rejected once Adam becomes busy — the test
 * deliberately does not assert which one wins, only that exactly one does and the loser has no
 * conversation with Adam. Eve and Frank, having lost the closest-match ranking on both passengers'
 * own devices, should end up with no conversations at all.
 */
test.describe('Taxi: 3 drivers, 2 passengers, closest match + busy rejection (§GG follow-up)', () => {
  let browsers: FiveBrowsers;
  let contextAdam: BrowserContext | undefined;
  let contextEve: BrowserContext | undefined;
  let contextFrank: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let contextAlice: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageEve: Page | undefined;
  let pageFrank: Page | undefined;
  let pageBob: Page | undefined;
  let pageAlice: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
    browsers = await launchFiveBrowsers();
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    };
    await Promise.all([cleanup(pageAdam), cleanup(pageEve), cleanup(pageFrank), cleanup(pageBob), cleanup(pageAlice)]);
    await Promise.all([
      pageAdam?.close().catch(() => {}),
      pageEve?.close().catch(() => {}),
      pageFrank?.close().catch(() => {}),
      pageBob?.close().catch(() => {}),
      pageAlice?.close().catch(() => {}),
    ]);
    await Promise.all([
      contextAdam?.close().catch(() => {}),
      contextEve?.close().catch(() => {}),
      contextFrank?.close().catch(() => {}),
      contextBob?.close().catch(() => {}),
      contextAlice?.close().catch(() => {}),
    ]);
    await shutdownFiveBrowsers(browsers);
    await clearGunForStage4Spec();
  });

  test('each driver matches its nearest passenger; a losing driver racing for the same passenger is rejected once busy', async () => {
    test.setTimeout(300_000);
    const ADAM_TITLE = 'Driver near Alice - Downtown';
    const EVE_TITLE = 'Driver near Bob - Downtown';
    const FRANK_TITLE = 'Driver closer to Alice than Bob - Downtown';
    const ALICE_TITLE = 'Looking for a taxi - Downtown (Alice)';
    const BOB_TITLE = 'Looking for a taxi - Downtown (Bob)';

    // Alice and Bob are pinned ~54 miles apart — genuinely distinguishable locations, not the
    // same spot with noise. Alice keeps bootstrapUser's default San Diego pin; Bob is pinned far
    // north of it.
    const ALICE_COORDS = { latitude: 32.7157, longitude: -117.1611 };
    const BOB_COORDS = { latitude: 33.50, longitude: -117.1611 };

    const adam = await bootstrapUser(browsers.adam, 'Adam', 'Adam');
    contextAdam = adam.context;
    pageAdam = adam.page;
    // Essentially co-located with Alice, ~54 miles from Bob — Adam ranks Alice as his closer
    // passenger every time.
    await pinStableE2eLocation(pageAdam, ALICE_COORDS);
    await createRideTalk(pageAdam, ADAM_TITLE, ADAM_ALICE_QUESTIONS, 'offer');

    const eve = await bootstrapUser(browsers.eve, 'Eve', 'Eve');
    contextEve = eve.context;
    pageEve = eve.page;
    // Essentially co-located with Bob, ~54 miles from Alice — Eve ranks Bob as her closer
    // passenger, uncontested (no other driver is nearer to Bob than to Alice).
    await pinStableE2eLocation(pageEve, BOB_COORDS);
    await createRideTalk(pageEve, EVE_TITLE, ADAM_ALICE_QUESTIONS, 'offer');

    const frank = await bootstrapUser(browsers.frank, 'Frank', 'Frank');
    contextFrank = frank.context;
    pageFrank = frank.page;
    // ~2.4 miles from Alice, ~52 miles from Bob — clearly closer to Alice than to Bob, so Frank
    // also ranks Alice as his nearer passenger and races Adam for her (Frank being farther from
    // Alice than Adam is irrelevant here — each driver only compares its two candidates against
    // itself, not against other drivers; see the file-level note on the offer/request asymmetry).
    await pinStableE2eLocation(pageFrank, { latitude: 32.75, longitude: -117.1611 });
    await createRideTalk(pageFrank, FRANK_TITLE, ADAM_ALICE_QUESTIONS, 'offer');

    const bob = await bootstrapUser(browsers.bob, 'Bob', 'Bob');
    contextBob = bob.context;
    pageBob = bob.page;
    await pinStableE2eLocation(pageBob, BOB_COORDS);
    await createRideTalk(pageBob, BOB_TITLE, ADAM_ALICE_QUESTIONS, 'request');

    const alice = await bootstrapUser(browsers.alice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;
    await pinStableE2eLocation(pageAlice, ALICE_COORDS);
    await createRideTalk(pageAlice, ALICE_TITLE, ADAM_ALICE_QUESTIONS, 'request');

    const [adamId, eveId, frankId, bobId, aliceId] = await Promise.all([
      getCurrentUserId(pageAdam),
      getCurrentUserId(pageEve),
      getCurrentUserId(pageFrank),
      getCurrentUserId(pageBob),
      getCurrentUserId(pageAlice),
    ]);
    for (const id of [adamId, eveId, frankId, bobId, aliceId]) expect(id).toBeTruthy();

    const localPages = [pageAdam, pageEve, pageFrank, pageBob, pageAlice];
    await Promise.all(localPages.map((page) => prepareLocalBroadcast(page)));
    // Concurrent, not sequential: mesh delivery + the closest-match debounce (800ms) can resolve
    // faster than a slow UI-driven click on every page in turn. A driver can legitimately
    // auto-match against an already-broadcast passenger request and auto-disable their OWN talk
    // before their own click-broadcast UI flow even finishes navigating — at that point they have
    // nothing left to broadcast, which is the correct outcome, not a failure to tolerate.
    await Promise.all(
      localPages.map((page) =>
        clickBroadcastUntilBulkAck(page).catch(() => {
          /* already matched-and-busy before this page's own broadcast completed — fine */
        }),
      ),
    );

    // === Eve uniquely gets Bob — no other driver ranked Bob as its nearer passenger. ===
    await expect.poll(() => hasConversationWith(pageBob!, eveId), { timeout: 60_000 }).toBe(true);
    expect(await conversationPartnerIds(pageBob!)).toEqual([eveId]);
    expect(await conversationPartnerIds(pageEve!)).toEqual([bobId]);
    await expect.poll(() => isOwnTalkDisabled(pageEve!, EVE_TITLE), { timeout: 15_000 }).toBe(true);

    // === Both Adam and Frank ranked Alice as their nearer passenger and raced to answer her
    // request — each independently computes isMatch locally and creates their OWN conversation
    // the instant they submit a matching response (existing app architecture, not something
    // this feature changes: a responder always commits locally before hearing back from the
    // owner). What THIS feature guarantees is on Alice's side, the talk owner: her own device
    // accepts only the first inquiry and rejects the second rather than double-booking herself
    // — so we assert her own view settles to exactly one partner, not that the losing driver's
    // own optimistic local state gets corrected (that would need a "match retracted, notify the
    // loser" mechanism this feature does not build). ===
    await expect
      .poll(() => conversationPartnerIds(pageAlice!), {
        timeout: 60_000,
        message: 'Alice should settle on exactly one driver partner, never both',
      })
      .toHaveLength(1);

    const alicePartners = await conversationPartnerIds(pageAlice!);
    const winnerId = alicePartners[0];
    expect([adamId, frankId]).toContain(winnerId);
    const winnerTitle = winnerId === adamId ? ADAM_TITLE : FRANK_TITLE;
    const winnerPage = winnerId === adamId ? pageAdam! : pageFrank!;

    // Alice never ends up double-booked — this is the real, verifiable "reject new match
    // inquiry" guarantee: whichever driver's response arrived second at Alice's device found
    // her talk already disabled and was rejected outright, not queued as a second conversation.
    expect(await conversationPartnerIds(pageAlice!)).toEqual([winnerId]);

    // The winning driver is now busy — their own offer talk auto-disabled the instant their
    // match with Alice was confirmed on their own device.
    await expect.poll(() => isOwnTalkDisabled(winnerPage, winnerTitle), { timeout: 15_000 }).toBe(true);
  });
});

/**
 * Simplest possible form of the taxi scenario, per feedback after the flow-based tests above:
 * a `type: 'tag'` talk — one question, a checkbox-style yes/no — is all a driver or passenger
 * should need to author, no multi-question criteria list at all. This exercises the exact same
 * matching engine as the flow-based tests above with zero additional code, since `checkIfMatch`
 * and the marketplace busy guard (`isExclusiveMarketplaceTalk` in `app.ts`) are talk-type-
 * agnostic — they key only on `Talk.role`, not on question count or structure. Matching stays
 * exact-text throughout (no fuzzy/approximate matching); distance-based "closest driver" ranking
 * with multiple simultaneous candidates is already covered by the flow-based race test above —
 * this test's own job is only to confirm the SIMPLEST possible talk (single tag question) is
 * sufficient, end to end, for two strangers to match with zero manual clicks.
 */
test.describe('Taxi: simplest form — a single-question tag talk per side (§GG follow-up, simple)', () => {
  let browserDriver: Browser;
  let browserPassenger: Browser;
  let contextDriver: BrowserContext | undefined;
  let contextPassenger: BrowserContext | undefined;
  let pageDriver: Page | undefined;
  let pagePassenger: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
    const mk = (x: number) => ({
      headless,
      slowMo: headless ? 0 : delay(50, 120),
      args: [...WEBRTC_CHROMIUM_ARGS, `--window-position=${x},0`, '--window-size=560,820', '--force-device-scale-factor=1'],
    });
    [browserDriver, browserPassenger] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(560))]);
  });

  test.afterAll(async () => {
    const cleanup = async (p?: Page) => {
      if (!p) return;
      await p.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup()).catch(() => {});
    };
    await Promise.all([cleanup(pageDriver), cleanup(pagePassenger)]);
    await Promise.all([pageDriver?.close().catch(() => {}), pagePassenger?.close().catch(() => {})]);
    await Promise.all([contextDriver?.close().catch(() => {}), contextPassenger?.close().catch(() => {})]);
    await Promise.all([browserDriver?.close().catch(() => {}), browserPassenger?.close().catch(() => {})]);
    await clearGunForStage4Spec();
  });

  /** One question, two answers — "am I available?" is all a driver or passenger has to say. */
  async function createSimpleTagTalk(page: Page, title: string, role: 'offer' | 'request'): Promise<void> {
    await page.click('#create-talk-btn');
    await page.waitForSelector('#talk-editor-form');
    await page.fill('#talk-title', title);
    await selectTalkEditorType(page, 'tag');
    await page.selectOption('#talk-role', role);
    const sendToChatroomCheckbox = page.locator('#talk-send-to-chatroom');
    if (await sendToChatroomCheckbox.isVisible().catch(() => false)) {
      await sendToChatroomCheckbox.uncheck();
    }
    await submitTalkEditorAndWaitForOut(page, title);
  }

  test('a single-question tag talk on each side is enough for the chatbot to match two strangers', async () => {
    test.setTimeout(120_000);
    const TITLE = 'Available for a ride - Downtown';

    const driver = await bootstrapUser(browserDriver, 'Driver', 'Driver');
    contextDriver = driver.context;
    pageDriver = driver.page;
    await createSimpleTagTalk(pageDriver, TITLE, 'offer');

    const passenger = await bootstrapUser(browserPassenger, 'Passenger', 'Passenger');
    contextPassenger = passenger.context;
    pagePassenger = passenger.page;
    await createSimpleTagTalk(pagePassenger, TITLE, 'request');

    const driverId = await getCurrentUserId(pageDriver);
    expect(driverId).toBeTruthy();

    const pages = [pageDriver, pagePassenger];
    await Promise.all(pages.map((page) => prepareLocalBroadcast(page)));
    await Promise.all(
      pages.map((page) =>
        clickBroadcastUntilBulkAck(page).catch(() => {
          /* already matched-and-busy before this page's own broadcast completed — fine */
        }),
      ),
    );

    await expect.poll(() => hasConversationWith(pagePassenger!, driverId), { timeout: 60_000 }).toBe(true);
    expect(await conversationPartnerIds(pagePassenger!)).toEqual([driverId]);
    // Busy-on-match still applies to the simplest talk shape too — no separate code path.
    await expect.poll(() => isOwnTalkDisabled(pagePassenger!, TITLE), { timeout: 15_000 }).toBe(true);
  });
});
