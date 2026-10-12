/**
 * List-view twin of 08-nearby-shrink-map (no map at all): four users, capacity 3. Every step saves
 * one 2×2 frame of all four users' chatroom lists (U1 U2 / U3 U4). "N / 3 people"
 * in each list shows the worldwide group filling, then splitting until every group holds ≤ 3.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runShrinkDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby shrink in the list view', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('four users arrive; the list shows the worldwide group split until every group holds ≤ 3', async () => {
    test.setTimeout(900_000);
    await clearGunForStage4Spec();
    demo = await runShrinkDemo(test.info(), 'list');
  });
});
