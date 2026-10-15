/**
 * J-START-02 on the phone route (docs/testing/journey-coverage.md): restarting the app keeps the
 * same identity. On a phone a restart stops the embedded node and the WebView together; both come
 * back on the same data. Here Alice's phone node is stopped and started again on its data dir and
 * her page reloads in the same browser storage. Bob, on another phone, must see the same Alice
 * (same id, same name, listed once) — not a stranger and not a duplicate — and so must the hub.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  closeUsers,
  currentRoomId,
  hubRoomMembers,
  memberItem,
  openCurrentRoom,
  openUser,
  resetPhonePath,
  stageName,
  startPhoneNode,
  userId,
  type JourneyUser,
  type SpecPhoneNode,
} from './phone-path-helpers';
import { PHONE_PATH_PORTS, PHONE_PATH_SPEC_PORTS } from './phone-path-ports';

test.describe('Restart on a phone keeps the identity', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;
  let phone: SpecPhoneNode | undefined;
  let dataDir = '';

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-phone-restart-'));
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
    await phone?.stop();
    phone = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('stop the phone node and the page, start both again → same person for Bob and the hub', async ({ browser, request }) => {
    test.setTimeout(300_000);
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.restartPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url });
    bob = await openUser(browser, 'Bob', 'phoneB');
    const [aliceId, aliceName] = [await userId(alice.page), await stageName(alice.page)];
    expect(aliceId).not.toBe('');

    await expect.poll(async () => (await currentRoomId(alice!.page)) !== '' && (await currentRoomId(alice!.page)) === (await currentRoomId(bob!.page)),
      { timeout: 30_000, message: 'Alice and Bob are not in the same Nearby room' }).toBe(true);
    const roomId = await currentRoomId(bob.page);
    await openCurrentRoom(bob.page);
    await expect(memberItem(bob.page, aliceId)).toBeAttached({ timeout: 45_000 });

    // The app is closed: page and phone node both stop.
    const context = alice.context;
    await alice.page.close();
    await phone.stop();

    // …and opened again on the same data.
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.restartPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url, context });
    expect(await userId(alice.page)).toBe(aliceId);
    expect(await stageName(alice.page)).toBe(aliceName);

    // Bob and the hub see the same Alice, once.
    await expect.poll(() => currentRoomId(alice!.page), { timeout: 30_000 }).toBe(roomId);
    await expect.poll(() => hubRoomMembers(request, roomId), { timeout: 45_000 }).toContain(aliceId);
    await openCurrentRoom(bob.page);
    await expect(memberItem(bob.page, aliceId)).toHaveCount(1, { timeout: 45_000 });
    await expect(memberItem(bob.page, aliceId)).toContainText(aliceName);
  });
});
