/**
 * Where two people's views must agree, across two phones (docs/testing/journey-coverage.md):
 *   J-TALK-04  a non-matching answer gives neither of them a conversation;
 *   J-TALK-05  after Bob blocks Alice, her Talks stop arriving on his phone;
 *   J-ROOM-03  when Alice leaves the room (moves away, then closes the app), Bob's member list
 *              and headcount drop her, and the hub agrees.
 * Every step is checked on the other person's screen or in the hub's data.
 */
import { test } from '@playwright/test';
import { blockJourney, leaveJourney, mismatchJourney } from '../journeys/mismatch-block-leave-journey';
import type { TestActor } from '../helpers/test-actor';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';
import { phonePathURL } from './phone-path-ports';

// The journey bodies are shared with native-app/38 (real phones): tests/e2e/journeys/.
const actor = (user: JourneyUser): TestActor => ({ id: user.label, runtime: 'browser', page: user.page });

test.describe('Mismatch, block and leave across two phones', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('J-TALK-04: a non-matching answer gives neither person a conversation', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    await mismatchJourney(actor(alice), actor(bob));
  });

  test('J-TALK-05: after Bob blocks Alice, her Talks stop arriving on his phone', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    await blockJourney(actor(alice), actor(bob));
  });

  test('J-ROOM-03: when Alice leaves, Bob\'s member list and headcount drop her', async ({ browser }) => {
    test.setTimeout(600_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const { goneAfterMs } = await leaveJourney(actor(alice), actor(bob), {
      hubUrl: phonePathURL('hub'),
      closeAlice: async () => { await closeUsers(alice); alice = undefined; },
    });
    test.info().annotations.push({ type: 'timing', description: `app closed → gone for Bob: ${goneAfterMs} ms` });
  });
});
