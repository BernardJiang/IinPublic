/**
 * Automatic Talk exchange (OPEN-112) across two phones (docs/testing/journey-coverage.md):
 *   J-AUTO-01  a private Talk switched to Broadcast reaches the other phone with no send step and
 *              is answered with "Auto";
 *   J-AUTO-02  the chatbot answers a later Talk from what it learnt, and the asker records the match;
 *   J-AUTO-03  a starter tag both people like is exchanged within seconds.
 * The journey body is shared with stage2/98 (browsers) and native-app/42 (real phones):
 * tests/e2e/journeys/auto-exchange-journey.ts. Here it runs on the phone route (OPEN-121).
 */
import { test } from '@playwright/test';
import { autoExchangeJourney } from '../journeys/auto-exchange-journey';
import type { TestActor } from '../helpers/test-actor';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';

const actor = (user: JourneyUser): TestActor => ({ id: user.label, runtime: 'browser', page: user.page });

test.describe('Automatic Talk exchange across two phones', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('J-AUTO-01..03: a public Talk arrives with no tap, and the chatbot answers the next one', async ({ browser }) => {
    test.setTimeout(420_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    const { timings } = await autoExchangeJourney(actor(alice), actor(bob));
    test.info().annotations.push({ type: 'timing', description: JSON.stringify(timings) });
  });
});
