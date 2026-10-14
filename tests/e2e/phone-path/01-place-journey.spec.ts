/**
 * Place journey across two phones (docs/testing/journey-coverage.md, J-PLACE-*).
 *
 * Alice on phone A creates a Place. Bob on phone B — a different embedded node, so the only way
 * he can learn about it is through the hub — finds it in his list, enters it, and both see each
 * other. Both leave; the empty Place is still listed for Bob and for Carol, a plain web user on
 * the hub, and Bob can enter it again. Each step is checked on the OTHER user's screen or in the
 * hub's own data, never only on the screen of the person who acted.
 *
 * Bugs this would have caught (2026-10-13): Place creation threw on phones (no WebCrypto); phone
 * Places stayed on the phone and never reached the hub; empty Places were hidden so nobody could
 * enter them; the relay gave up on the hub's slow empty-room member read.
 */
import { test, expect } from '@playwright/test';
import {
  closeUsers,
  createPlace,
  currentRoomId,
  enterRoomFromList,
  hubActiveRoomIds,
  hubListsPlace,
  hubRoomMembers,
  memberItem,
  openUser,
  resetPhonePath,
  returnHome,
  userId,
  waitForRoomRow,
  type JourneyUser,
} from './phone-path-helpers';

test.describe('Place journey: phone A creates, phone B and a web user find and enter it', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;
  let carol: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob, carol);
    alice = bob = carol = undefined;
  });

  test('create → found by others → enter → see each other → leave → still findable', async ({ browser, request }) => {
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');

    // J-PLACE-01: creating a Place on a phone succeeds and the creator stands in it.
    const name = `Journey Cafe ${Date.now()}`;
    const placeId = await createPlace(alice.page, name);

    // J-PLACE-02: the hub knows the Place (it did not stay on phone A).
    await expect.poll(() => hubListsPlace(request, placeId), { timeout: 20_000, message: 'hub never listed the Place' }).toBe(true);
    const aliceId = await userId(alice.page);
    await expect.poll(() => hubRoomMembers(request, placeId), { timeout: 20_000, message: 'hub never saw Alice in her Place' })
      .toContain(aliceId);
    // …and lists it among rooms with people, which is what other users' room lists show.
    await expect.poll(() => hubActiveRoomIds(request), { timeout: 20_000, message: 'hub active-rooms list lacks the occupied Place' })
      .toContain(placeId);

    // J-PLACE-03: Bob on another phone finds it and enters it.
    await enterRoomFromList(bob.page, placeId);
    const bobId = await userId(bob.page);

    // J-PLACE-04: the hub has both members, and each sees the other in the room's member list.
    await expect.poll(() => hubRoomMembers(request, placeId), { timeout: 30_000, message: 'hub does not have both members' })
      .toEqual(expect.arrayContaining([aliceId, bobId]));
    await expect(memberItem(alice.page, bobId)).toBeAttached({ timeout: 30_000 });
    await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 30_000 });

    // J-PLACE-05: both leave; the Place is empty but stays listed for Bob…
    await returnHome(bob.page);
    await returnHome(alice.page);
    await waitForRoomRow(bob.page, placeId);

    // …and for Carol, a plain web user on the hub (J-PLACE-06)…
    carol = await openUser(browser, 'Carol', 'hub');
    await waitForRoomRow(carol.page, placeId);

    // …and Bob can enter the empty Place again (J-PLACE-07).
    await enterRoomFromList(bob.page, placeId);
    expect(await currentRoomId(bob.page)).toBe(placeId);
  });
});
