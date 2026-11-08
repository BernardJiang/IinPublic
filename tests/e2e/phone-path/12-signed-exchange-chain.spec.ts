/**
 * OPEN-108 on the phone route (J-GRAPH-01/02, tests/e2e/journeys/signed-exchange-chain-journey.ts):
 * Alice and Bob exchange a Talk and its matching answer through the app, each phone's own event
 * chain verifies and each holds the other's signed acknowledgement. Then Alice's phone is stopped,
 * one of her own chained events is rewritten in the node's radata on disk, and the restarted core
 * reports the break at that event's seq — reported, never repaired. The web version is stage2/97,
 * real phones native-app/39.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test, expect } from '@playwright/test';
import { tamperRadataDir } from '../helpers/radisk-tamper';
import { expectSignedExchange, expectTamperReported } from '../journeys/signed-exchange-chain-journey';
import { talkMatchChatJourney } from '../journeys/talk-match-chat-journey';
import { closeUsers, openUser, resetPhonePath, startPhoneNode, userId, type JourneyUser, type SpecPhoneNode } from './phone-path-helpers';
import { PHONE_PATH_PORTS, PHONE_PATH_SPEC_PORTS } from './phone-path-ports';

test.describe('Signed exchange chain on the phone route (OPEN-108)', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;
  let phone: SpecPhoneNode | undefined;
  let dataDir = '';

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-phone-chain-'));
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
    await phone?.stop();
    phone = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('each phone proves the other\'s signed entry and ack; a tampered event is reported after restart', async ({ browser }) => {
    test.setTimeout(420_000);
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.chainPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url });
    bob = await openUser(browser, 'Bob', 'phoneB');
    const aliceActor = { id: 'Alice', runtime: 'browser' as const, page: alice.page };
    const bobActor = { id: 'Bob', runtime: 'browser' as const, page: bob.page };
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

    // A real exchange through the app: Alice's Talk, Bob's matching answer, the conversation.
    await talkMatchChatJourney(aliceActor, bobActor);
    await expectSignedExchange(aliceActor, aliceId, bobActor, bobId);

    await expectTamperReported(aliceActor, async (deviceId) => {
      // The app is closed: page and phone node both stop, so nothing writes the store.
      const context = alice!.context;
      await alice!.page.close();
      await phone!.stop();
      const tampered = tamperRadataDir(path.join(dataDir, 'radata'), { field: 'title', device: deviceId });
      expect(String(tampered.after)).toContain('HACKED');
      // …and opened again on the tampered data.
      phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.chainPhone, PHONE_PATH_PORTS.hub, dataDir);
      alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url, context });
      expect(await userId(alice.page)).toBe(aliceId);
      return { page: alice.page, seq: tampered.seq };
    });

    // Reported, never repaired: the rewritten value is still what the phone stores.
    const stored = fs.readdirSync(path.join(dataDir, 'radata'))
      .map((name) => fs.readFileSync(path.join(dataDir, 'radata', name), 'utf8'))
      .some((text) => text.includes('HACKED '));
    expect(stored).toBe(true);
  });
});
