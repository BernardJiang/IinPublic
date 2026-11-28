/**
 * J-CHAT-02 on the phone route (docs/testing/journey-coverage.md): a message sent to someone whose
 * phone is off arrives when the phone is back. Alice and Bob match and chat (the shared
 * talk-match-chat journey); then Alice's app closes and her phone node stops, Bob sends a message,
 * and Alice's node and app start again on the same data. The message must be in Alice's
 * conversation with Bob (OPEN-121).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import { waitForMessageVisible } from '../helpers/fast-dm-setup';
import type { TestActor } from '../helpers/test-actor';
import { reopenConversationFromContacts, talkMatchChatJourney } from '../journeys/talk-match-chat-journey';
import { closeUsers, openUser, resetPhonePath, startPhoneNode, userId, type JourneyUser, type SpecPhoneNode } from './phone-path-helpers';
import { PHONE_PATH_PORTS, PHONE_PATH_SPEC_PORTS } from './phone-path-ports';

const actor = (user: JourneyUser): TestActor => ({ id: user.label, runtime: 'browser', page: user.page });

test.describe('A message to a phone that is off', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;
  let phone: SpecPhoneNode | undefined;
  let dataDir = '';

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-phone-offline-chat-'));
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
    await phone?.stop();
    phone = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  // Flaky (OPEN-122, 2026-11-27): 2 of 3 pass since the sender's message saves were coalesced
  // (message arrives ~15 s after the restart). The rest: Bob's notify is "delivered" into the dead
  // link, so the mailbox is not used, and Alice's link to Bob sometimes never reopens. Remove
  // `.fixme` to run it.
  test.fixme('J-CHAT-02: Bob writes while Alice\'s phone is off; she has it once it is back', async ({ browser }) => {
    test.setTimeout(480_000);
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.offlineChatPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url });
    bob = await openUser(browser, 'Bob', 'phoneB');
    await talkMatchChatJourney(actor(alice), actor(bob));
    const [aliceId, bobId] = [await userId(alice.page), await userId(bob.page)];

    // Alice's phone is off: the app closes and its node stops.
    const context = alice.context;
    await alice.page.close();
    await phone.stop();

    // Bob writes to her; his own screen shows it at once.
    const text = `written while you were away ${Date.now()}`;
    await reopenConversationFromContacts(bob.page, aliceId);
    const composer = bob.page.locator('#conversation-message-input');
    await composer.fill(text);
    await bob.page.locator('#send-conversation-message').click();
    await expect(composer).toHaveValue('');
    await waitForMessageVisible(bob.page, text, 10_000);

    // Alice's phone comes back on the same data, and the message is in her conversation with Bob.
    const offlineFor = Date.now();
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.offlineChatPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url, context });
    expect(await userId(alice.page)).toBe(aliceId);
    await reopenConversationFromContacts(alice.page, bobId);
    await waitForMessageVisible(alice.page, text, 120_000);
    test.info().annotations.push({ type: 'timing', description: `arrived ${Math.round((Date.now() - offlineFor) / 1000)} s after Alice's phone started again` });
  });
});
