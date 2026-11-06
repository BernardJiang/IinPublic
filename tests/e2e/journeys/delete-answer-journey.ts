/**
 * Deleting my answer (OPEN-106 step 4), written once against TestActor: phone-path/11 runs it with
 * host phone nodes. Every step is checked on the other person's side too.
 *
 *   J-TALK-01/02  A writes and broadcasts a Talk; B receives it and gives the matching answer;
 *   J-TALK-03     both get the conversation, and A's device decided B's answer as a match;
 *   J-ANS-01      B deletes that answer from the Me tab (long-press, Delete answer);
 *   J-ANS-02      B's Me row and B's "already answered" for the Talk are gone;
 *   J-ANS-03      A's device forgets how it decided B's answer, and A's conversation with B is
 *                 withdrawn, saying B deleted their answer.
 */
import { expect, type Page } from '@playwright/test';
import { createSimpleFlowTalk, goToChatrooms } from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../helpers/talk-demo-ui';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../helpers/talks-matching-flow';
import { waitForServerConversationBetween } from '../helpers/conversation-e2e';
import { clickAppBarAction, longPressRow } from '../helpers/list-row-actions';
import type { TestActor } from '../helpers/test-actor';
import { currentRoomId, memberItem, openCurrentRoom, userId } from '../phone-path/phone-path-helpers';

const MATCH_ANSWER = 'Yes match';

/** My own Talk's id, by its title. */
function myTalkId(page: Page, title: string): Promise<string> {
  return page.evaluate((t) => {
    const talks = (window as any).__iinpublic_collection?.('myTalks') ?? {};
    const hit = Object.entries(talks).find(([, e]: [string, any]) => e?.role === 'created' && e?.title === t);
    return hit ? hit[0] : '';
  }, title);
}

/** How the author's device decided this person's answer to the Talk (`ix/outcome`), or null. */
function outcomeFor(page: Page, talkId: string, responderId: string): Promise<unknown> {
  return page.evaluate(async ({ tId, rId }) => {
    const doc: any = await (window as any).__iinpublic_app?.getApp?.()?.getExchangesForE2e?.([tId]);
    return doc?.outcomes?.[tId]?.[rId] ?? null;
  }, { tId: talkId, rId: responderId });
}

function conversationWith(page: Page, peerId: string): Promise<{ status?: string; lastMessage?: string } | null> {
  return page.evaluate((pid) => {
    const conversations = (window as any).__iinpublic_collection?.('myConversations') ?? {};
    const conv: any = Object.values(conversations).find((c: any) => c?.otherUserId === pid);
    return conv ? { status: conv.status, lastMessage: conv.lastMessage } : null;
  }, peerId);
}

/** The responder's Me rows for this Talk (the Me tab shows each answered question). */
function meRows(page: Page, title: string) {
  return page.locator('#answers-list .answer-talk-item').filter({ hasText: title });
}

/** Whether the responder's My Talks still holds an answer to a Talk with this title. */
function stillAnswered(page: Page, title: string): Promise<boolean> {
  return page.evaluate((t) => {
    const talks = (window as any).__iinpublic_collection?.('myTalks') ?? {};
    return Object.values(talks).some((e: any) => e?.title === t && Array.isArray(e?.completedAnswers) && e.completedAnswers.length > 0);
  }, title);
}

export async function deleteAnswerJourney(alice: TestActor, bob: TestActor): Promise<void> {
  const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

  await expect.poll(async () => (await currentRoomId(alice.page)) === (await currentRoomId(bob.page)) && (await currentRoomId(bob.page)) !== '',
    { timeout: 60_000, message: `${alice.id} and ${bob.id} are not in the same Nearby room` }).toBe(true);
  await openCurrentRoom(alice.page);
  await openCurrentRoom(bob.page);
  await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 60_000 });
  await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 60_000 });

  // J-TALK-01/02: A's Talk reaches B, who answers it as a match.
  const title = `Delete answer ${Date.now()}`;
  await createSimpleFlowTalk(alice.page, title, MATCH_ANSWER, 'No mismatch', { sendToChatroom: false });
  const talkId = await myTalkId(alice.page, title);
  expect(talkId, `${alice.id}: the Talk is not in My Talks`).toBeTruthy();
  await goToChatrooms(alice.page);
  await openCurrentRoom(alice.page);
  await clickBroadcastUntilBulkAck(alice.page);

  await openIncomingTalkModal(bob.page, title);
  await bob.page.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}" i][data-mode="manual"]`).first().click();
  await waitForResponseModalClosed(bob.page);

  // J-TALK-03: the match, on both sides.
  await Promise.all([
    waitForServerConversationBetween(alice.page, aliceId, bobId),
    waitForServerConversationBetween(bob.page, bobId, aliceId),
  ]);
  await expect.poll(() => outcomeFor(alice.page, talkId, bobId), {
    timeout: 30_000, message: `${alice.id}: ${bob.id}'s answer was not decided`,
  }).not.toBeNull();

  // J-ANS-01: B deletes the answer from the Me tab, as a person would.
  await bob.page.locator('.nav-btn[data-view="me"]').click();
  await expect(bob.page.locator('.nav-btn[data-view="me"].active')).toBeVisible({ timeout: 20_000 });
  const row = meRows(bob.page, title).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await longPressRow(bob.page, row);
  bob.page.once('dialog', (dialog) => { void dialog.accept(); });
  await clickAppBarAction(bob.page, 'me-delete-answer-btn');

  // J-ANS-02: gone from B's Me tab and from B's answered Talks.
  // At once, not after the core's forget lands: the page hides a Talk whose answers it deleted.
  await expect(meRows(bob.page, title)).toHaveCount(0, { timeout: 5_000 });
  await expect.poll(() => stillAnswered(bob.page, title), { timeout: 30_000 }).toBe(false);

  // J-ANS-03: A's device forgets B's answer, and A's conversation with B is withdrawn.
  await expect.poll(() => outcomeFor(alice.page, talkId, bobId), {
    timeout: 60_000, message: `${alice.id}: still holds ${bob.id}'s deleted answer`,
  }).toBeNull();
  await expect.poll(() => conversationWith(alice.page, bobId), {
    timeout: 30_000, message: `${alice.id}: the conversation with ${bob.id} was not withdrawn`,
  }).toMatchObject({ status: 'withdrawn', lastMessage: expect.stringMatching(/^They deleted their answer/) });
}
