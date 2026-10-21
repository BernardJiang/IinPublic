/**
 * A Talk still arrives after the direct link between two phones has been rebuilt several times
 * (found on real phones 2026-10-18, native-app/39): a reconnect let the previous channel's
 * encrypted handshake finish late, the two phones derived different sessions, and the pair stayed
 * "connected" while nothing could cross it. Both sides must end on the same confirmed session, and
 * a Talk sent afterwards must reach the other side. The exact race needs a slow contact-key lookup
 * and is pinned deterministically by src/test/unit/p2p-session-handshake-race.test.ts.
 */
import { expect, test } from '@playwright/test';
import { findIncomingTalkIdByTitle } from '../helpers/talk-demo-ui';
import { createSimpleFlowTalk } from '../helpers/broadcast-cancellation-helpers';
import { closeUsers, currentRoomId, openUser, resetPhonePath, userId, type JourneyUser } from './phone-path-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe('Direct link rebuilt: phone A reconnects to phone B, then sends a Talk', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('three reconnects → same confirmed session on both sides → Talk received', async ({ browser }) => {
    test.setTimeout(240_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];
    await expect.poll(async () => (await currentRoomId(alice!.page)) !== '' && (await currentRoomId(alice!.page)) === (await currentRoomId(bob!.page)),
      { timeout: 60_000, message: 'Alice and Bob should share one Nearby room' }).toBe(true);

    const sessionOf = (page: typeof alice.page, otherId: string) => page.evaluate((other) => {
      const session = (window as any).__iinpublic_app?.getApp?.()?.peerMeshService?.neighbors?.get?.(other)?.session;
      return session ? { id: String(session.secureSessionId || ''), confirmed: session.secureSessionConfirmed === true } : null;
    }, otherId);
    const agreed = async () => {
      const [a, b] = [await sessionOf(alice!.page, bobId), await sessionOf(bob!.page, aliceId)];
      return !!a && !!b && a.confirmed && b.confirmed && a.id !== '' && a.id === b.id;
    };
    await expect.poll(agreed, { timeout: 60_000, message: 'the first link should confirm one session' }).toBe(true);

    // The side that makes the WebRTC offer rebuilds the link, as the Wi-Fi Direct switch does.
    const [initiator, otherId] = aliceId.localeCompare(bobId) < 0 ? [alice, bobId] : [bob, aliceId];
    for (let rep = 0; rep < 3; rep += 1) {
      await initiator.page.evaluate(async (other) => {
        const session = (window as any).__iinpublic_app.getApp().peerMeshService.neighbors.get(other).session;
        await session.reconnect(20_000).catch(() => undefined);
      }, otherId);
      await expect.poll(agreed, { timeout: 45_000, message: `after reconnect ${rep + 1} both sides should hold the same confirmed session` }).toBe(true);
    }

    const title = `After reconnect ${Date.now()}`;
    await createSimpleFlowTalk(alice.page, title, 'Yes match', 'No mismatch', { sendToChatroom: false });
    const talkId = await alice.page.evaluate((expectedTitle) => {
      const talks = JSON.parse(localStorage.getItem('myTalks') || '{}');
      return Object.entries(talks).find(([, value]: [string, any]) => value?.role === 'created' && value?.title === expectedTitle)?.[0] ?? '';
    }, title);
    expect(talkId).not.toBe('');
    const sent = await alice.page.evaluate(async ({ id, other, otherName }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const talk = JSON.parse(localStorage.getItem('myTalks') || '{}')[id]?.fullTalk;
      return app.deliverTalkToReceiversOverMesh(id, talk, [{ userId: other, stageName: otherName }], [other]);
    }, { id: talkId, other: bobId, otherName: 'Bob' });
    expect(sent).toBe(true);
    await expect.poll(async () => {
      try {
        return await findIncomingTalkIdByTitle(bob!.page, title);
      } catch {
        return '';
      }
    }, { timeout: 45_000, message: 'Bob should receive the Talk sent after the reconnects' }).toBe(talkId);
  });
});
