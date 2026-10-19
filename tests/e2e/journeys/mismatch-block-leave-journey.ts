/**
 * Where two people's views must agree, written once against TestActor (docs/testing/
 * android-core-test-plan.md, conversion step 2): phone-path/04 runs these with host phone nodes and
 * native-app/38 with two real phones. Every step is checked on the other person's screen, on their
 * own node, or in the hub's data.
 *   J-TALK-04  a non-matching answer gives neither of them a conversation;
 *   J-TALK-05  after Bob blocks Alice, her Talks stop arriving on his phone;
 *   J-ROOM-03  when Alice leaves the room (moves away, then closes the app), Bob's member list
 *              and headcount drop her, and the hub agrees.
 * Node queries use a relative fetch from the actor's page: every page is served by that person's
 * own node (an embedded node on a phone, the phone-path node on the Mac).
 */
import { expect, type Page } from '@playwright/test';
import { createSimpleFlowTalk, goToChatrooms } from '../helpers/broadcast-cancellation-helpers';
import { clickBroadcastUntilBulkAck } from '../helpers/talk-demo-ui';
import {
  localIncomingClustersIncludeTitle,
  openIncomingTalkModal,
  waitForResponseModalClosed,
} from '../helpers/talks-matching-flow';
import { waitForStatusBarMatchCountAtMost } from '../helpers/durable-ui';
import type { TestActor } from '../helpers/test-actor';
import { createPlace, currentRoomId, memberItem, openCurrentRoom, openRoomList, returnHome, userId } from '../phone-path/phone-path-helpers';

const MATCH = 'Yes match';
const MISMATCH = 'No mismatch';

async function sameRoomAndVisible(alice: TestActor, bob: TestActor): Promise<{ aliceId: string; bobId: string; roomId: string }> {
  const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];
  await expect.poll(async () => {
    const [a, b] = [await currentRoomId(alice.page), await currentRoomId(bob.page)];
    return a !== '' && a === b;
  }, { timeout: 60_000, message: `${alice.id} and ${bob.id} are not in the same Nearby room` }).toBe(true);
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
  try {
    await clickBroadcastUntilBulkAck(page, { minSent: 0 });
  } catch (error) {
    const state = await page.evaluate(() => {
      const visible = (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement | null;
        return element ? `${element.offsetParent !== null ? 'shown' : 'hidden'}${(element as HTMLButtonElement).disabled ? ',disabled' : ''}` : 'absent';
      };
      const ack = document.querySelector('[data-testid="broadcast-bulk-ack"]');
      const app = (window as any).__iinpublic_app?.getApp?.();
      return {
        broadcastBtn: visible('#broadcast-talk-btn'),
        statusBroadcastBtn: visible('#status-broadcast-talk-btn'),
        preamble: visible('[data-testid="broadcast-preamble-modal"]'),
        gen: ack?.getAttribute('data-broadcast-bulk-gen'),
        sent: ack?.getAttribute('data-broadcast-talks-sent'),
        pending: app?.uiManager?.getBroadcastableTalkIds?.(),
        notifications: [...document.querySelectorAll('.notification')].map((n) => n.textContent?.trim()).slice(-3),
        modals: [...document.querySelectorAll('.modal, [role="dialog"]')].filter((m) => (m as HTMLElement).offsetParent !== null).map((m) => m.id || m.className).slice(0, 5),
      };
    }).catch((probeError) => ({ probeError: String(probeError) }));
    throw new Error(`broadcast did not complete: ${JSON.stringify(state)}\n${String(error)}`);
  }
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

/** Block status as the viewer's own node reports it. */
function blockStatus(page: Page, viewer: string, peer: string): Promise<{ blocked?: boolean; blockedBy?: boolean }> {
  return page.evaluate(async ({ v, p }) => {
    const res = await fetch(`/api/users/${encodeURIComponent(v)}/block-status/${encodeURIComponent(p)}`, { cache: 'no-store' });
    return res.ok ? res.json() : {};
  }, { v: viewer, p: peer });
}

/** Members of a room as the hub lists them. */
/**
 * Who the hub knows in this room. Nearby is a personal list (§3.7) with no hub roster: there, the
 * people the hub would introduce to a newcomer at the journey's point.
 */
async function hubRoomMembers(hubUrl: string, roomId: string): Promise<string[]> {
  if (roomId === 'nearby-v3') {
    const res = await fetch(`${hubUrl}/api/nearby/v3/introductions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ point: { latitude: 32.7157, longitude: -117.1611 } }),
    }).catch(() => null);
    if (!res?.ok) return [];
    const body = await res.json().catch(() => ({})) as { cards?: Array<{ userId?: string }> };
    return (body.cards ?? []).map((card) => String(card.userId || '')).filter(Boolean);
  }
  const res = await fetch(`${hubUrl}/api/chatrooms/${encodeURIComponent(roomId)}/members`).catch(() => null);
  if (!res?.ok) return [];
  const body = await res.json().catch(() => ({})) as any;
  const list = Array.isArray(body) ? body : body.members || [];
  return list.map((m: any) => String(m?.id || m?.userId || m?.pub || m)).filter(Boolean);
}

export async function mismatchJourney(alice: TestActor, bob: TestActor): Promise<void> {
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
}

export async function blockJourney(alice: TestActor, bob: TestActor): Promise<void> {
  const { aliceId, bobId } = await sameRoomAndVisible(alice, bob);

  // Delivery works before the block (so the later silence means something).
  const before = `Before block ${Date.now()}`;
  await broadcastTalk(alice.page, before);
  await expect.poll(() => localIncomingClustersIncludeTitle(bob.page, before), { timeout: 45_000, message: 'Bob never got the first Talk' })
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
  await expect.poll(async () => Boolean((await blockStatus(bob.page, bobId, aliceId)).blocked), {
    timeout: 30_000, message: 'Bob\'s own phone never recorded the block',
  }).toBe(true);

  // Alice broadcasts again; nothing reaches Bob.
  const after = `After block ${Date.now()}`;
  await broadcastTalk(alice.page, after);
  await bob.page.waitForTimeout(15_000);
  expect(await localIncomingClustersIncludeTitle(bob.page, after)).toBe(false);

  // Alice's side, as on the web (stage2/15b): her phone learns she is blocked, so Bob's profile
  // shows as unavailable to her. A block made on a phone has to leave that phone for this.
  await expect.poll(async () => Boolean((await blockStatus(alice.page, aliceId, bobId)).blockedBy), {
    timeout: 30_000, message: 'Alice\'s phone never learned that Bob blocked her',
  }).toBe(true);
  await openCurrentRoom(alice.page);
  await memberItem(alice.page, bobId).click();
  await expect(alice.page.locator('#peer-detail-overlay')).toBeVisible({ timeout: 15_000 });
  await expect(alice.page.locator('#peer-stats-section')).toContainText('Profile unavailable', { timeout: 15_000 });
}

/** Alice moves away, comes back, then closes the app (closeAlice); Bob and the hub drop her. */
export async function leaveJourney(alice: TestActor, bob: TestActor, options: { hubUrl: string; closeAlice: () => Promise<void> }): Promise<{ goneAfterMs: number }> {
  const { aliceId, roomId } = await sameRoomAndVisible(alice, bob);
  await expect.poll(() => hubRoomMembers(options.hubUrl, roomId), { timeout: 30_000 }).toContain(aliceId);
  await expect.poll(() => roomHeadcount(bob.page), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const together = await roomHeadcount(bob.page);

  // Alice moves away (into a Place of her own): Bob's room loses her.
  await createPlace(alice.page, `Away ${Date.now()}`);
  await openCurrentRoom(bob.page);
  await expect(memberItem(bob.page, aliceId)).toHaveCount(0, { timeout: 45_000 });
  await expect.poll(() => roomHeadcount(bob.page), { timeout: 45_000, message: 'Bob\'s headcount did not drop' }).toBe(together - 1);
  // A shared room's hub roster drops her at once. Nearby has none: the hub's introduction sample
  // keeps her card until it expires (§3.7), and Bob's own list is what matters.
  const personal = roomId === 'nearby-v3';
  if (!personal) await expect.poll(() => hubRoomMembers(options.hubUrl, roomId), { timeout: 30_000 }).not.toContain(aliceId);

  // She comes back: Bob sees her again.
  await returnHome(alice.page);
  await openCurrentRoom(bob.page);
  await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 45_000 });
  await expect.poll(() => roomHeadcount(bob.page), { timeout: 45_000 }).toBe(together);

  // She closes the app. Like a phone app being killed, the leave request may not get out, so
  // the room relies on the membership TTL (ROOM_MEMBERSHIP_TTL_SECONDS, 3 min) and the sweep:
  // within about four minutes Bob's list, his headcount and the hub drop her.
  await options.closeAlice();
  const closedAt = Date.now();
  if (!personal) await expect.poll(() => hubRoomMembers(options.hubUrl, roomId), { timeout: 240_000, intervals: [5_000] }).not.toContain(aliceId);
  await expect.poll(async () => {
    await openCurrentRoom(bob.page);
    return memberItem(bob.page, aliceId).count();
  }, { timeout: 120_000, intervals: [5_000] }).toBe(0);
  await expect.poll(() => roomHeadcount(bob.page), { timeout: 60_000 }).toBe(together - 1);
  return { goneAfterMs: Date.now() - closedAt };
}
