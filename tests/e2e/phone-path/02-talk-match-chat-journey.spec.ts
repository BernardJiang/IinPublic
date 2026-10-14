/**
 * Core loop across two phones (docs/testing/journey-coverage.md, J-TALK-*): Alice on phone A
 * writes and broadcasts a talk in their shared Nearby room; Bob on phone B receives it and gives
 * the matching answer; both get a conversation, the direct P2P channel connects, and a message
 * Alice sends shows up on Bob's screen.
 *
 * Every step is checked on the receiving side. All traffic takes the phone route (WebView →
 * embedded node → hub relay), which no browser spec covers.
 */
import { test, expect } from '@playwright/test';
import { createSimpleFlowTalk, goToChatrooms } from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../helpers/talk-demo-ui';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../helpers/talks-matching-flow';
import { prepareDirectP2PConversation } from '../helpers/p2p-transport-e2e';
import { sendConversationMessage, waitForMessageVisible } from '../helpers/fast-dm-setup';
import { closeUsers, currentRoomId, memberItem, openCurrentRoom, openUser, resetPhonePath, stageName, userId, type JourneyUser } from './phone-path-helpers';

const MATCH_ANSWER = 'Yes match';

test.describe('Talk journey: phone A broadcasts, phone B answers, they match and chat', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('broadcast → received → answered → match → P2P chat', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

    // J-ROOM-01: two people at the same spot on different phones share one Nearby room and see
    // each other in it.
    await expect.poll(async () => (await currentRoomId(alice!.page)) === (await currentRoomId(bob!.page)) && (await currentRoomId(bob!.page)) !== '',
      { timeout: 30_000, message: 'Alice and Bob are not in the same Nearby room' }).toBe(true);
    await openCurrentRoom(alice.page);
    await openCurrentRoom(bob.page);
    await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 45_000 });
    await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 45_000 });

    // J-TALK-01: Alice writes and broadcasts a talk.
    const title = `Phone talk ${Date.now()}`;
    await createSimpleFlowTalk(alice.page, title, MATCH_ANSWER, 'No mismatch', { sendToChatroom: false });
    await goToChatrooms(alice.page);
    await openCurrentRoom(alice.page);
    await clickBroadcastUntilBulkAck(alice.page);

    // J-TALK-02: Bob receives it and answers with the matching answer.
    await openIncomingTalkModal(bob.page, title);
    await bob.page.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(bob.page);

    // J-TALK-03: both get the conversation and the direct P2P channel connects.
    const conversationId = await prepareDirectP2PConversation(
      alice.page, bob.page, aliceId, bobId, await stageName(bob.page), await stageName(alice.page),
    );

    // J-CHAT-01: a message Alice sends appears on Bob's screen.
    const hello = `hello from phone A ${Date.now()}`;
    await sendConversationMessage(alice.page, conversationId, aliceId, hello);
    await waitForMessageVisible(bob.page, hello, 30_000);
  });
});
