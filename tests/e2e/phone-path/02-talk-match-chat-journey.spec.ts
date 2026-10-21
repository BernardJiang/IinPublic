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
    // The journey body is shared with native-app/37 (real phones): tests/e2e/journeys/.
    await talkMatchChatJourney({ id: 'Alice', runtime: 'browser', page: alice.page }, { id: 'Bob', runtime: 'browser', page: bob.page });
  });
});
