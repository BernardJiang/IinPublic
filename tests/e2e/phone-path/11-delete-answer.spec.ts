/**
 * Deleting my answer on the phone route (OPEN-106 step 4): Alice on phone A broadcasts a Talk,
 * Bob on phone B answers it as a match, then deletes that answer from his Me tab. Checked on both
 * sides: Bob's answer is gone, and Alice's device forgets how it decided it and withdraws the
 * conversation. The journey is shared: `journeys/delete-answer-journey.ts`.
 */
import { test } from '@playwright/test';
import { deleteAnswerJourney } from '../journeys/delete-answer-journey';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';

test.describe('Delete my answer: phone B deletes its answer, phone A follows', () => {
  let alice: JourneyUser | undefined;
  let bob: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(alice, bob);
    alice = bob = undefined;
  });

  test('answer → match → delete on B → A forgets it and withdraws the conversation', async ({ browser }) => {
    test.setTimeout(300_000);
    alice = await openUser(browser, 'Alice', 'phoneA');
    bob = await openUser(browser, 'Bob', 'phoneB');
    await deleteAnswerJourney({ id: 'Alice', runtime: 'browser', page: alice.page }, { id: 'Bob', runtime: 'browser', page: bob.page });
  });
});
