/**
 * Core loop across two phones (docs/testing/journey-coverage.md, J-TALK-*): Alice on phone A
 * writes and broadcasts a talk in their shared Nearby room; Bob on phone B receives it and gives
 * the matching answer; both get a conversation, the direct P2P channel connects, and a message
 * Alice sends shows up on Bob's screen.
 *
 * Every step is checked on the receiving side. All traffic takes the phone route (WebView →
 * embedded node → hub relay), which no browser spec covers.
 */
import { test } from '@playwright/test';
import { deviceGraphStatus, expectDeviceGraph, expectGraphAnswerHistory, expectGraphEvent } from '../helpers/device-graph';
import { talkMatchChatJourney } from '../journeys/talk-match-chat-journey';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';

test.describe('Talk journey: phone A broadcasts, phone B answers, they match and chat', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('broadcast → received → answered → match → P2P chat', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    // clear-database does not wipe a phone node's device core, so a rerun on the same nodes
    // starts with the Talks an earlier run wrote: count the new one.
    const talksBefore = Number((await deviceGraphStatus(alice.page))?.talks ?? 0);
    // OPEN-106: both phones write their Talks and answers into the device graph.
    // The journey body is shared with native-app/37 (real phones): tests/e2e/journeys/.
    await talkMatchChatJourney({ id: 'Alice', runtime: 'browser', page: alice.page }, { id: 'Bob', runtime: 'browser', page: bob.page });

    // The device graph holds Alice's Talk.
    await expectDeviceGraph(alice.page, 'Alice', { talks: talksBefore + 1 });
    // The Talk reached the responder over a graph link, and the answer came back over it.
    await expectGraphEvent(bob.page, 'Bob', 'talk');
    await expectGraphEvent(alice.page, 'Alice', 'answer');
    // Bob's Me tab reads that answer from Bob's device graph.
    await expectGraphAnswerHistory(bob.page, 'Bob');
  });
});
