/**
 * OPEN-122: messages I sent are stored on my phone, even when I close the app right after a quick
 * burst. Alice and Bob match and chat (the shared talk-match-chat journey ends with Alice sending two
 * messages back to back); one second later Alice's app closes and her phone node stops, then both
 * start again on the same data. Every message she had on screen must still be there.
 * Before 2026-11-27 each message's save waited for storage to confirm (~1.5 s on the phone node)
 * before the next began, so a burst of six took ~9 s to store and a restart lost the last ones.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from '@playwright/test';
import type { TestActor } from '../helpers/test-actor';
import { reopenConversationFromContacts, talkMatchChatJourney } from '../journeys/talk-match-chat-journey';
import { closeUsers, openUser, resetPhonePath, startPhoneNode, userId, type JourneyUser, type SpecPhoneNode } from './phone-path-helpers';
import { PHONE_PATH_PORTS, PHONE_PATH_SPEC_PORTS } from './phone-path-ports';

const actor = (user: JourneyUser): TestActor => ({ id: user.label, runtime: 'browser', page: user.page });
const shownMessages = (user: JourneyUser) => user.page.locator('#conversation-messages .message-text').allTextContents();

test.describe('Sent messages survive a restart', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;
  let phone: SpecPhoneNode | undefined;
  let dataDir = '';

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-phone-burst-'));
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
    await phone?.stop();
    phone = undefined;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  test('a burst of my own messages is still there after the app closes a second later', async ({ browser }) => {
    test.setTimeout(420_000);
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.burstPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url });
    bob = await openUser(browser, 'Bob', 'phoneB');
    await talkMatchChatJourney(actor(alice), actor(bob));
    const bobId = await userId(bob.page);
    await reopenConversationFromContacts(alice.page, bobId);
    const before = await shownMessages(alice);
    expect(before.length).toBeGreaterThanOrEqual(6);

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const context = alice.context;
    await alice.page.close();
    await phone.stop();
    phone = await startPhoneNode(PHONE_PATH_SPEC_PORTS.burstPhone, PHONE_PATH_PORTS.hub, dataDir);
    alice = await openUser(browser, 'Alice', 'phoneA', { baseUrl: phone.url, context });
    await reopenConversationFromContacts(alice.page, bobId);
    await expect.poll(async () => {
      const after = await shownMessages(alice!);
      return before.filter((text) => !after.includes(text));
    }, {
      timeout: 30_000, message: 'messages missing after the restart',
    }).toEqual([]);
  });
});
