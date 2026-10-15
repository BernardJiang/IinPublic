/**
 * Where two people's views must agree, across two phones (docs/testing/journey-coverage.md):
 *   J-TALK-04  a non-matching answer gives neither of them a conversation;
 *   J-TALK-05  after Bob blocks Alice, her Talks stop arriving on his phone;
 *   J-ROOM-03  when Alice leaves the room (moves away, then closes the app), Bob's member list
 *              and headcount drop her, and the hub agrees.
 * Every step is checked on the other person's screen or in the hub's data.
 */
import { test, expect, type Page } from '@playwright/test';
import { createSimpleFlowTalk, goToChatrooms } from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../helpers/talk-demo-ui';
import {
  localIncomingClustersIncludeTitle,
  openIncomingTalkModal,
  waitForResponseModalClosed,
} from '../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtMost } from '../helpers/durable-ui';
import {
  closeUsers,
  createPlace,
  currentRoomId,
  hubRoomMembers,
  memberItem,
  openCurrentRoom,
  openRoomList,
  openUser,
  resetPhonePath,
  returnHome,
  userId,
  type JourneyUser,
} from './phone-path-helpers';
import { phonePathURL } from './phone-path-ports';

const MATCH = 'Yes match';
const MISMATCH = 'No mismatch';

async function sameRoomAndVisible(alice: JourneyUser, bob: JourneyUser): Promise<{ aliceId: string; bobId: string; roomId: string }> {
  const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];
  await expect.poll(async () => {
    const [a, b] = [await currentRoomId(alice.page), await currentRoomId(bob.page)];
    return a !== '' && a === b;
  }, { timeout: 30_000, message: 'Alice and Bob are not in the same Nearby room' }).toBe(true);
  await openCurrentRoom(alice.page);
  await openCurrentRoom(bob.page);
  await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 45_000 });
  await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 45_000 });
  return { aliceId, bobId, roomId: await currentRoomId(alice.page) };
}

async function broadcastTalk(page: Page, title: string): Promise<void> {
  await createSimpleFlowTalk(page, title, MATCH, MISMATCH, { sendToChatroom: false });
  await goToChatrooms(page);
  await openCurrentRoom(page);
  await clickBroadcastUntilBulkAck(page, { minSent: 0 });
}

/** Conversations in the user's own store with one particular person. */
function conversationsWith(page: Page, otherId: string): Promise<string[]> {
  return page.evaluate(async (other) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const rows: any[] = await app?.conversationService?.getUserConversationsSnapshot?.(app.currentUser.id) ?? [];
    return rows.filter((row) => row?.otherUserId === other).map((row) => String(row?.conversationId || ''));
  }, otherId);
}

function matchCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.uiManager?.getTotalMatches?.() ?? -1);
}

/** The headcount on the user's current room in the room list, as the person sees it. */
async function roomHeadcount(page: Page): Promise<number> {
  await openRoomList(page);
  const text = await page.locator('.chatroom-item.current-room .chatroom-headcount:visible').first().textContent().catch(() => '');
  return Number(text?.match(/\d+/)?.[0] || '0');
}

test.describe('Mismatch, block and leave across two phones', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('J-TALK-04: a non-matching answer gives neither person a conversation', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const { aliceId, bobId } = await sameRoomAndVisible(alice, bob);

    const title = `Mismatch talk ${Date.now()}`;
    await broadcastTalk(alice.page, title);
    await openIncomingTalkModal(bob.page, title);
    await bob.page.locator(`input.choice-radio[data-answer-text="${MISMATCH}"][data-mode="manual"]`).first().click();
    await waitForResponseModalClosed(bob.page);

    // Bob's answer is recorded as a mismatch on his side…
    await bob.page.click('.nav-btn[data-view="me"]');
    const answerRow = bob.page.locator('#answers-content .answer-talk-item').filter({ hasText: `Want a partner? ${title}` }).first();
    await expect(answerRow).toBeVisible({ timeout: 20_000 });
    await expect(answerRow).toHaveAttribute('data-outcome', 'mismatch');

    // …and, given time for a (wrong) match to propagate, neither has a match or a conversation.
    await alice.page.waitForTimeout(8_000);
    await waitForStatusBarMatchCountAtMost(alice.page, 0);
    await waitForStatusBarMatchCountAtMost(bob.page, 0);
    expect(await conversationsWith(alice.page, bobId)).toEqual([]);
    expect(await conversationsWith(bob.page, aliceId)).toEqual([]);
  });

  test('J-TALK-05: after Bob blocks Alice, her Talks stop arriving on his phone', async ({ browser, request }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const { aliceId, bobId } = await sameRoomAndVisible(alice, bob);

    // Delivery works before the block (so the later silence means something).
    const before = `Before block ${Date.now()}`;
    await broadcastTalk(alice.page, before);
    await expect.poll(() => localIncomingClustersIncludeTitle(bob!.page, before), { timeout: 45_000, message: 'Bob never got the first Talk' })
      .toBe(true);

    // Receiving a Talk is not a match: nobody has answered (seen on the first run: both status
    // bars said "1 match" by the time Bob blocked her).
    await bob.page.waitForTimeout(5_000);
    expect(await matchCount(alice.page), 'Alice has a match before Bob answered').toBe(0);
    expect(await matchCount(bob.page), 'Bob has a match before answering').toBe(0);

    // Bob opens Alice from the room's member list and blocks her (⋯ → Block User).
    await openCurrentRoom(bob.page);
    await memberItem(bob.page, aliceId).click();
    await expect(bob.page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await bob.page.waitForTimeout(3_000);
    expect(await matchCount(bob.page), 'opening Alice\'s profile made a match').toBe(0);
    await bob.page.click('#back-from-conversation');
    await expect(bob.page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 10_000 });
    await bob.page.click('#peer-overflow-btn');
    await bob.page.locator('[data-testid="peer-block-user-btn"]').click();
    const skip = bob.page.locator('[data-testid="block-notify-skip"]');
    if (await skip.isVisible().catch(() => false)) await skip.click();

    // Bob's phone records the block.
    const blockStatus = async (origin: 'phoneA' | 'phoneB' | 'hub', viewer: string, peer: string) => {
      const res = await request.get(`${phonePathURL(origin)}/api/users/${encodeURIComponent(viewer)}/block-status/${encodeURIComponent(peer)}`);
      return res.ok() ? (await res.json()) as { blocked?: boolean; blockedBy?: boolean } : {};
    };
    await expect.poll(async () => Boolean((await blockStatus('phoneB', bobId, aliceId)).blocked), {
      timeout: 30_000, message: 'Bob\'s own phone never recorded the block',
    }).toBe(true);

    // Alice broadcasts again; nothing reaches Bob.
    const after = `After block ${Date.now()}`;
    await broadcastTalk(alice.page, after);
    await bob.page.waitForTimeout(15_000);
    expect(await localIncomingClustersIncludeTitle(bob.page, after)).toBe(false);

    // Alice's side, as on the web (stage2/15b): her phone learns she is blocked, so Bob's profile
    // shows as unavailable to her. A block made on a phone has to leave that phone for this.
    await expect.poll(async () => Boolean((await blockStatus('phoneA', aliceId, bobId)).blockedBy), {
      timeout: 30_000, message: 'Alice\'s phone never learned that Bob blocked her',
    }).toBe(true);
    await openCurrentRoom(alice.page);
    await memberItem(alice.page, bobId).click();
    await expect(alice.page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
    await expect(alice.page.locator('#peer-stats-section')).toContainText('Profile unavailable', { timeout: 15_000 });
  });

  test('J-ROOM-03: when Alice leaves, Bob\'s member list and headcount drop her', async ({ browser, request }) => {
    test.setTimeout(600_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const { aliceId, roomId } = await sameRoomAndVisible(alice, bob);
    await expect.poll(() => hubRoomMembers(request, roomId), { timeout: 30_000 }).toContain(aliceId);
    await expect.poll(() => roomHeadcount(bob!.page), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const together = await roomHeadcount(bob.page);

    // Alice moves away (into a Place of her own): Bob's room loses her.
    await createPlace(alice.page, `Away ${Date.now()}`);
    await openCurrentRoom(bob.page);
    await expect(memberItem(bob.page, aliceId)).toHaveCount(0, { timeout: 45_000 });
    await expect.poll(() => roomHeadcount(bob!.page), { timeout: 45_000, message: 'Bob\'s headcount did not drop' }).toBe(together - 1);
    await expect.poll(() => hubRoomMembers(request, roomId), { timeout: 30_000 }).not.toContain(aliceId);

    // She comes back: Bob sees her again.
    await returnHome(alice.page);
    await openCurrentRoom(bob.page);
    await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 45_000 });
    await expect.poll(() => roomHeadcount(bob!.page), { timeout: 45_000 }).toBe(together);

    // She closes the app. Like a phone app being killed, the leave request may not get out, so
    // the room relies on the membership TTL (ROOM_MEMBERSHIP_TTL_SECONDS, 3 min) and the sweep:
    // within about four minutes Bob's list, his headcount and the hub drop her.
    await closeUsers(alice);
    alice = undefined;
    const closedAt = Date.now();
    await expect.poll(() => hubRoomMembers(request, roomId), { timeout: 240_000, intervals: [5_000] }).not.toContain(aliceId);
    await expect.poll(async () => {
      await openCurrentRoom(bob!.page);
      return memberItem(bob!.page, aliceId).count();
    }, { timeout: 120_000, intervals: [5_000] }).toBe(0);
    await expect.poll(() => roomHeadcount(bob!.page), { timeout: 60_000 }).toBe(together - 1);
    test.info().annotations.push({ type: 'timing', description: `app closed → gone for Bob: ${Date.now() - closedAt} ms` });
  });
});
