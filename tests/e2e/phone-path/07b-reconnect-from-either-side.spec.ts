/**
 * OPEN-74: a fresh `reconnect()` must succeed from either end of a direct link. On real phones each
 * pair's first reconnect failed, and over an offline Wi-Fi Direct group every one did (native-app/39,
 * 2026-10-18): the other phone applied the fresh offer to its old, still-connected RTCPeerConnection,
 * and a phone that answers offers never got a new one after rebuilding its own side.
 */
import { expect, test } from '@playwright/test';
import { closeUsers, currentRoomId, openUser, resetPhonePath, userId, type JourneyUser } from './phone-path-helpers';

/* eslint-disable @typescript-eslint/no-explicit-any */
test.describe('Direct link rebuilt from either side', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('every reconnect resolves, from the offering side and from the answering side', async ({ browser }) => {
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
    // Nearby links open on demand: ask Alice's mesh for a link to Bob.
    await alice.page.evaluate((other) => (window as any).__iinpublic_app.getApp().peerMeshService.openPersonalLink?.(other), bobId);
    await expect.poll(agreed, { timeout: 60_000, message: 'the first link should confirm one session' }).toBe(true);

    const reconnect = (page: typeof alice.page, other: string) => page.evaluate(async (peer) => {
      const session = (window as any).__iinpublic_app.getApp().peerMeshService.neighbors.get(peer).session;
      const started = Date.now();
      try {
        await session.reconnect(20_000);
        return { ok: true, ms: Date.now() - started, initiator: session.isInitiator === true };
      } catch (error) {
        return { ok: false, ms: Date.now() - started, initiator: session.isInitiator === true, error: String(error) };
      }
    }, other);

    const results = [];
    for (const [page, other] of [[alice.page, bobId], [bob.page, aliceId], [alice.page, bobId], [bob.page, aliceId]] as const) {
      const result = await reconnect(page, other);
      results.push(result);
      await expect.poll(agreed, { timeout: 45_000, message: `after reconnect ${results.length} both sides should hold the same confirmed session` }).toBe(true);
    }
    console.log(`[07b] reconnects: ${JSON.stringify(results)}`);
    expect(results.map((result) => result.ok), JSON.stringify(results)).toEqual([true, true, true, true]);
    expect(new Set(results.map((result) => result.initiator)).size, 'both roles were exercised').toBe(2);
  });
});
