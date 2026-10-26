/**
 * The tag graph tour on the phone route: one tag walks every edge — place, people, Talks and
 * answers — with Ann on phone A, Ben on phone B and Cy on the hub. Every Talk, answer and Nearby
 * card takes the phone route (WebView → embedded node → hub relay). The walk itself is
 * `journeys/tag-graph-tour-journey.ts`, shared with staged/stage3-three-user/82.
 */
import { test } from '@playwright/test';
import { tagGraphTourJourney } from '../journeys/tag-graph-tour-journey';
import { closeUsers, openUser, resetPhonePath, type JourneyUser } from './phone-path-helpers';

test.describe('Tag graph tour across phones', () => {
  let ann: JourneyUser | undefined;
  let ben: JourneyUser | undefined;
  let cy: JourneyUser | undefined;

  test.beforeEach(async ({ request }) => {
    await resetPhonePath(request);
  });

  test.afterEach(async () => {
    await closeUsers(ann, ben, cy);
    ann = ben = cy = undefined;
  });

  test('one tag walks every edge: place, people, Talks and answers', async ({ browser }) => {
    test.setTimeout(420_000);
    ann = await openUser(browser, 'Ann', 'phoneA');
    ben = await openUser(browser, 'Ben', 'phoneB');
    cy = await openUser(browser, 'Cy', 'hub');
    await tagGraphTourJourney(ann.page, ben.page, cy.page);
  });
});
