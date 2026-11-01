/**
 * The core loop between two people, written once against TestActor (docs/testing/
 * android-core-test-plan.md, conversion step 2): phone-path/02 runs it with host phone nodes and
 * native-app/37 with two real phones. Every step is checked on the receiving side.
 *
 *   J-ROOM-01  both are in the same Nearby room and see each other in it;
 *   J-TALK-01  A writes and broadcasts a talk;
 *   J-TALK-02  B receives it and gives the matching answer;
 *   J-TALK-03  both get the conversation and the direct P2P channel connects;
 *   J-CHAT-01  a message A sends appears on B's screen;
 *   J-CHAT-04  sending never makes anyone wait (dm-speed-journey.ts).
 */
import { expect } from '@playwright/test';
import { createSimpleFlowTalk, goToChatrooms } from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../helpers/talk-demo-ui';
import { openIncomingTalkModal, waitForResponseModalClosed } from '../helpers/talks-matching-flow';
import { prepareDirectP2PConversation } from '../helpers/p2p-transport-e2e';
import { waitForMessageVisible } from '../helpers/fast-dm-setup';
import type { TestActor } from '../helpers/test-actor';
import { dmSpeedJourney } from './dm-speed-journey';
import { currentRoomId, memberItem, openCurrentRoom, stageName, userId } from '../phone-path/phone-path-helpers';

const MATCH_ANSWER = 'Yes match';

async function reopenConversationFromContacts(page: TestActor['page'], peerId: string): Promise<void> {
  const overlay = page.locator('#conversation-detail-overlay');
  if (await overlay.isVisible().catch(() => false)) {
    await page.locator('#back-from-conversation').click();
  }
  await page.locator('.nav-btn[data-view="contacts"]').click();
  await expect(page.locator('.nav-btn[data-view="contacts"].active')).toBeVisible({ timeout: 20_000 });
  const row = page
    .locator(`#contacts-list .contact-item[data-contact-user-id="${peerId}"]`)
    .first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator('.contact-item-name').click();
  if (!(await overlay.isVisible().catch(() => false))) {
    const peerDetail = page.locator('#peer-detail-overlay');
    await expect(peerDetail).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="dm-thread-entry"]').click();
  }
  await expect(overlay).toBeVisible({ timeout: 20_000 });
}

export async function talkMatchChatJourney(alice: TestActor, bob: TestActor): Promise<{ timings: Record<string, number> }> {
  const timings: Record<string, number> = {};
  const lap = (() => { let last = Date.now(); return (name: string) => { timings[name] = Date.now() - last; last = Date.now(); }; })();
  const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

  await expect.poll(async () => (await currentRoomId(alice.page)) === (await currentRoomId(bob.page)) && (await currentRoomId(bob.page)) !== '',
    { timeout: 60_000, message: `${alice.id} and ${bob.id} are not in the same Nearby room` }).toBe(true);
  await openCurrentRoom(alice.page);
  await openCurrentRoom(bob.page);
  await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 60_000 });
  await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 60_000 });
  lap('sameRoom');

  const title = `Journey talk ${Date.now()}`;
  await createSimpleFlowTalk(alice.page, title, MATCH_ANSWER, 'No mismatch', { sendToChatroom: false });
  await goToChatrooms(alice.page);
  await openCurrentRoom(alice.page);
  await clickBroadcastUntilBulkAck(alice.page);
  lap('broadcast');

  await openIncomingTalkModal(bob.page, title);
  lap('received');
  await bob.page.locator(`input.choice-radio[data-answer-text="${MATCH_ANSWER}"][data-mode="manual"]`).first().click();
  await waitForResponseModalClosed(bob.page);

  const [bobName, aliceName] = [await stageName(bob.page), await stageName(alice.page)];
  const conversationId = await prepareDirectP2PConversation(
    alice.page, bob.page, aliceId, bobId, bobName, aliceName,
  );
  await Promise.all([
    reopenConversationFromContacts(alice.page, bobId),
    reopenConversationFromContacts(bob.page, aliceId),
  ]);
  lap('matchAndP2P');

  const hello = `hello from ${alice.id} ${Date.now()}`;
  const composer = alice.page.locator('#conversation-message-input');
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(hello);
  await alice.page.locator('#send-conversation-message').click();
  await expect(composer).toHaveValue('');
  await waitForMessageVisible(bob.page, hello, 30_000);
  lap('dm');
  Object.assign(timings, await dmSpeedJourney(alice, bob));
  return { timings };
}
