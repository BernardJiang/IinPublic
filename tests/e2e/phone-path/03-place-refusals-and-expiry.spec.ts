/**
 * Place refusals and expiry across phones (docs/testing/journey-coverage.md, J-PLACE-08…11).
 *
 * The browser suite checks these against the desktop hub only (stage1/54, unit and integration
 * tests). On a phone the New Room dialog talks to the phone's node, which publishes at the hub
 * first and passes the hub's 409 back — so a refusal must survive that relay and reach the
 * person in words, and the refused Place must not be kept on the phone. Each refusal is checked
 * in the hub's own list as well as on the screen.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  backdatePlace,
  clickAppBarAction,
  closeUsers,
  createPlace,
  currentRoomId,
  enterRoomFromList,
  hubRoomMembers,
  listedRoomIds,
  notification,
  openRoomList,
  openUser,
  resetPhonePath,
  returnHome,
  roomRow,
  startPhoneNode,
  userId,
  waitForRoomRow,
  type JourneyUser,
  type SpecPhoneNode,
} from './phone-path-helpers';
import { PHONE_PATH_SPEC_PORTS, phonePathURL } from './phone-path-ports';

const HUB = phonePathURL('hub');

/** Fill the New Room dialog and submit, without waiting for a result. */
async function submitNewPlace(page: Page, name: string): Promise<void> {
  await page.locator('.nav-btn[data-view="chatrooms"]').click();
  await clickAppBarAction(page, '#create-custom-chatroom-btn');
  await page.locator('[data-testid="custom-room-name-input"]').fill(name);
  await page.locator('[data-testid="custom-room-submit-btn"]').click();
}

function signingPub(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.gunService?.getStoredPair?.()?.pub || '');
}

async function placeIds(baseUrl: string, request: Parameters<typeof listedRoomIds>[0], creatorPub?: string): Promise<string[]> {
  return (await listedRoomIds(request, baseUrl, creatorPub)).filter((id) => id.startsWith('place_'));
}

test.describe('Place refusals and expiry on the phone route', () => {
  const users: Array<JourneyUser | undefined> = [];
  let extraNode: SpecPhoneNode | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(...users);
    users.length = 0;
    await extraNode?.stop();
    extraNode = undefined;
  });

  test('J-PLACE-08: too few Friend marks, and one Place per person', async ({ browser, request }) => {
    // Too few incoming Friend marks: the dialog never opens, and the person is told why.
    const dana = await openUser(browser, 'Dana', 'phoneB', { placeMinFriendMarks: 3 });
    users.push(dana);
    await dana.page.locator('.nav-btn[data-view="chatrooms"]').click();
    await clickAppBarAction(dana.page, '#create-custom-chatroom-btn');
    await expect(notification(dana.page, /at least 3 people.*Friend.*0 Friend marks/i)).toBeVisible({ timeout: 15_000 });
    await expect(dana.page.locator('[data-testid="custom-room-name-input"]')).toHaveCount(0);

    // One Place per person: Alice's second Place is refused by the hub, through her phone.
    const alice = await openUser(browser, 'Alice', 'phoneA');
    users.push(alice);
    const firstName = `First Place ${Date.now()}`;
    const firstId = await createPlace(alice.page, firstName);
    await returnHome(alice.page);
    await submitNewPlace(alice.page, `Second Place ${Date.now()}`);
    await expect(notification(alice.page, /already have a room/i)).toBeVisible({ timeout: 30_000 });
    await expect(notification(alice.page, new RegExp(firstName))).toBeVisible();
    expect(await currentRoomId(alice.page)).not.toMatch(/^place_/);

    // Neither the hub nor Alice's phone has a second Place.
    const alicePub = await signingPub(alice.page);
    expect(await placeIds(HUB, request, alicePub)).toEqual([firstId]);
    expect(await placeIds(phonePathURL('phoneA'), request, alicePub)).toEqual([firstId]);
  });

  test('J-PLACE-09: same name in the cell joins the existing Place; a full cell refuses', async ({ browser, request }) => {
    test.setTimeout(480_000);
    const alice = await openUser(browser, 'Alice', 'phoneA');
    users.push(alice);
    const name = `Corner Shop ${Date.now()}`;
    const placeId = await createPlace(alice.page, name);
    const aliceId = await userId(alice.page);

    // Bob on the other phone picks the same name (different case and spacing): he is told it
    // exists and is moved into Alice's Place, and the hub has both of them in it.
    const bob = await openUser(browser, 'Bob', 'phoneB');
    users.push(bob);
    await submitNewPlace(bob.page, `  ${name.toUpperCase().replace(' ', '   ')} `);
    await expect(notification(bob.page, /already exists here/i)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => currentRoomId(bob.page), { timeout: 60_000, message: 'Bob was not moved into the existing Place' })
      .toBe(placeId);
    const bobId = await userId(bob.page);
    await expect.poll(() => hubRoomMembers(request, placeId), { timeout: 30_000 })
      .toEqual(expect.arrayContaining([aliceId, bobId]));
    expect(await placeIds(HUB, request)).toEqual([placeId]);

    // Four more people (alternating phones) fill the cell to five live Places…
    for (let i = 0; i < 4; i += 1) {
      const creator = await openUser(browser, `Creator${i}`, i % 2 === 0 ? 'phoneA' : 'phoneB');
      users.push(creator);
      await createPlace(creator.page, `Cell Place ${i} ${Date.now()}`);
    }
    await expect.poll(async () => (await placeIds(HUB, request)).length, { timeout: 30_000 }).toBe(5);

    // …and a sixth, on a phone, is refused with the reason, and nothing is added anywhere.
    const erin = await openUser(browser, 'Erin', 'phoneB');
    users.push(erin);
    await submitNewPlace(erin.page, `Sixth Place ${Date.now()}`);
    await expect(notification(erin.page, /already has 5 rooms/i)).toBeVisible({ timeout: 30_000 });
    expect(await currentRoomId(erin.page)).not.toMatch(/^place_/);
    expect(await placeIds(HUB, request)).toHaveLength(5);
    expect(await placeIds(phonePathURL('phoneB'), request)).toHaveLength(5);
  });

  test('J-PLACE-10: hub unreachable while creating → clear error, nothing kept on the phone', async ({ browser, request }) => {
    // A phone whose hub is gone (nothing listens on deadHub).
    extraNode = await startPhoneNode(PHONE_PATH_SPEC_PORTS.offlinePhone, PHONE_PATH_SPEC_PORTS.deadHub);
    const olga = await openUser(browser, 'Olga', 'phoneA', { baseUrl: extraNode.url });
    users.push(olga);
    await submitNewPlace(olga.page, `Offline Place ${Date.now()}`);
    await expect(notification(olga.page, /could not create room.*(reach|network)/i)).toBeVisible({ timeout: 30_000 });
    expect(await currentRoomId(olga.page)).not.toMatch(/^place_/);
    const olgaPub = await signingPub(olga.page);
    expect(await placeIds(extraNode.url, request, olgaPub)).toEqual([]);
    expect(await placeIds(HUB, request, olgaPub)).toEqual([]);
  });

  test('J-PLACE-11: a Place with no visits for 30 days drops out of other people\'s lists', async ({ browser, request }) => {
    test.setTimeout(360_000);
    const alice = await openUser(browser, 'Alice', 'phoneA');
    users.push(alice);
    const placeId = await createPlace(alice.page, `Old Bakery ${Date.now()}`);
    const alicePub = await signingPub(alice.page);

    // Bob on the other phone has been inside it, so both phones hold a copy.
    const bob = await openUser(browser, 'Bob', 'phoneB');
    users.push(bob);
    await enterRoomFromList(bob.page, placeId);
    await returnHome(bob.page);
    await returnHome(alice.page);
    await waitForRoomRow(bob.page, placeId);
    // Let the visit end at the hub first: a heartbeat sent just before leaving can reach the hub
    // after a backdate and count as a visit (it is one).
    await expect.poll(() => hubRoomMembers(request, placeId), { timeout: 30_000 }).toEqual([]);

    // 31 days pass with nobody visiting.
    await backdatePlace(request, placeId, 31);

    // The hub and both phones stop listing it…
    for (const base of [HUB, phonePathURL('phoneA'), phonePathURL('phoneB')]) {
      await expect.poll(() => placeIds(base, request), { timeout: 20_000, message: `${base} still lists the expired Place` })
        .not.toContain(placeId);
    }
    // …so a new user on either phone, or on the web, never sees it…
    for (const [label, origin] of [['Carol', 'hub'], ['Dave', 'phoneB']] as const) {
      const viewer = await openUser(browser, label, origin);
      users.push(viewer);
      await openRoomList(viewer.page);
      await viewer.page.waitForTimeout(3_000);
      await openRoomList(viewer.page);
      await expect(roomRow(viewer.page, placeId)).toHaveCount(0);
    }
    // …while its creator still finds it under her own key.
    expect(await placeIds(phonePathURL('phoneA'), request, alicePub)).toContain(placeId);
  });
});
