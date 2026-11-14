/**
 * Automatic Talk exchange (OPEN-112): the user only decides which Talks are public; there is no
 * Broadcast step, and the chatbot answers what it has learnt. Written once against TestActor so a
 * browser spec and two real phones (native-app/42) run the same body. Checked on the other side.
 *
 *   J-AUTO-01  A switches a private Talk to Broadcast On from its Talks row; B's row on A's list
 *              lights up as it goes out (sending stays visible); B gets it with no send step and
 *              answers it with "Auto", so B's chatbot learns the answer;
 *   J-AUTO-02  A answers her own (private) Talk asking Q2; B publishes a Talk asking Q2. Nobody
 *              touches an answer: A's chatbot answers it from her own answer and B's device
 *              records the match. (Asking A's first question again would not be sent at all:
 *              what a pair already exchanged is not offered twice, REQ-LEDGER-16.)
 */
import { expect } from '@playwright/test';
import { createSimpleFlowTalk } from '../helpers/broadcast-cancellation-helpers';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../helpers/talks-matching-flow';
import type { TestActor } from '../helpers/test-actor';
import { currentRoomId, memberItem, openCurrentRoom, userId } from '../phone-path/phone-path-helpers';

const MATCH_ANSWER = 'Yes, count me in';
const IGNORE_ANSWER = 'Not this time';
const QUESTION = 'Up for a walk by the bay this weekend?';
const QUESTION_2 = 'Coffee near the station after work?';

type Page = TestActor['page'];

async function myTalkId(page: Page, title: string): Promise<string> {
  let id = '';
  await expect.poll(async () => {
    id = await page.evaluate((wanted) => {
      const mine = ((window as any).__iinpublic_collection?.('myTalks') ?? {}) as Record<string, any>;
      return Object.keys(mine).find((key) => mine[key]?.role === 'created' && mine[key]?.title === wanted) ?? '';
    }, title);
    return id;
  }, { timeout: 30_000, message: `no created Talk "${title}"` }).not.toBe('');
  return id;
}

/** Talk ids whose answer from `responderId` my device recorded as matched. */
async function matchedTalkIds(page: Page, responderId: string): Promise<string[]> {
  return page.evaluate(async (responder) => {
    const doc: any = await (window as any).__iinpublic_app?.getApp?.()?.getExchangesForE2e?.();
    return Object.entries(doc?.outcomes ?? {})
      .filter(([, byResponder]: [string, any]) => byResponder?.[responder]?.outcome === 'matched')
      .map(([talkId]) => talkId.split('__')[0]!);
  }, responderId);
}

export async function autoExchangeJourney(alice: TestActor, bob: TestActor): Promise<{ timings: Record<string, number> }> {
  const timings: Record<string, number> = {};
  const lap = (() => { let last = Date.now(); return (name: string) => { timings[name] = Date.now() - last; last = Date.now(); }; })();
  const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

  // Both on each other's Nearby list: that is the whole audience.
  await expect.poll(async () => (await currentRoomId(alice.page)) === (await currentRoomId(bob.page)) && (await currentRoomId(bob.page)) !== '',
    { timeout: 60_000, message: `${alice.id} and ${bob.id} are not in the same Nearby room` }).toBe(true);
  await openCurrentRoom(alice.page);
  await openCurrentRoom(bob.page);
  await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 90_000 });
  await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 90_000 });
  lap('sameList');

  // J-AUTO-01: a private Talk stays home; switching it on is the only step.
  const run = Date.now();
  const first = `Auto exchange A ${run}`;
  await createSimpleFlowTalk(alice.page, first, MATCH_ANSWER, IGNORE_ANSWER, { isPublic: false, timeoutMs: 30_000, questionText: QUESTION });
  await alice.page.click('.nav-btn[data-view="talks"]');
  const row = alice.page.locator('.talk-list-item[data-role="created"]').filter({ hasText: first }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  const toggle = row.locator('.talk-broadcast-toggle-checkbox');
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(row).toHaveClass(/talk-broadcast-enabled/);
  // Sending stays visible with no Broadcast button: Bob's row on Alice's list lights up as the
  // Talk goes out to him (a 2.5 s highlight, so watch for it rather than read it once).
  await expect(memberItem(alice.page, bobId)).toHaveClass(/broadcast-sent-to/, { timeout: 60_000 });
  lap('published');

  await openIncomingTalkModal(bob.page, first);
  lap('received');
  // The Auto column's mode is the device-wide scope: "whenever" by default, "auto" for same-context.
  await bob.page.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="whenever"], input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="auto"]`).first().click();
  await waitForResponseModalClosed(bob.page);
  const firstId = await myTalkId(alice.page, first);
  await expect.poll(() => matchedTalkIds(alice.page, bobId), { timeout: 120_000, message: `${alice.id}: no match from ${bob.id} on "${first}"` })
    .toContain(firstId);
  lap('firstMatch');

  // J-AUTO-02: Alice answers her own new Talk (the editor's self-answer) with question Q2, then Bob
  // publishes a Talk asking Q2. Nobody touches an answer: Alice's chatbot answers Bob's Talk from
  // her own answer, and Bob's device records the match.
  const aliceOwn = `Auto exchange B ${run}`;
  await createSimpleFlowTalk(alice.page, aliceOwn, MATCH_ANSWER, IGNORE_ANSWER, { isPublic: false, timeoutMs: 30_000, questionText: QUESTION_2 });
  const bobsTalk = `Auto exchange C ${run}`;
  await createSimpleFlowTalk(bob.page, bobsTalk, MATCH_ANSWER, IGNORE_ANSWER, { timeoutMs: 30_000, questionText: QUESTION_2 });
  const bobsTalkId = await myTalkId(bob.page, bobsTalk);
  try {
    await expect.poll(() => matchedTalkIds(bob.page, aliceId), { timeout: 180_000, message: `${bob.id}: ${alice.id}'s chatbot did not answer "${bobsTalk}"` })
      .toContain(bobsTalkId);
  } catch (error) {
    // Where it stopped: did the Talk reach Alice, and is it waiting in her list instead of answered?
    const onAlice = await alice.page.evaluate(async (title) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const clusters = (await app?.getLocalIncomingClustersForE2e?.()) ?? [];
      return {
        arrived: JSON.stringify(clusters).includes(title),
        chatbotEnabled: app?.uiManager?.getChatbotEnabled?.(),
        notes: [...document.querySelectorAll('.notification')].map((n) => n.textContent?.trim()).slice(-5),
      };
    }, bobsTalk).catch((probe) => ({ probe: String(probe) }));
    throw new Error(`${String(error)}\n${alice.id} state: ${JSON.stringify(onAlice)}`);
  }
  lap('chatbotMatch');
  return { timings };
}
