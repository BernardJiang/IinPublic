/**
 * Visual demo, continuing 08-nearby-shrink-map: travel between adjacent Nearby regions (C = 3).
 *
 * 1. Four users around San Diego split the worldwide Nearby group down until it settles as two
 *    adjacent regions: A holds 3 users, B holds 1.
 * 2. One user of A taps a point inside B on the map and joins B as a traveler → A = 2, B = 2.
 *    Neither region is over capacity, so nothing splits.
 * 3. Two users move back into A: B's original user travels to a point in A, and the traveler
 *    presses Return home. A now has 4 > C, so A is replaced again by smaller regions. If A were
 *    already at the deepest partition level, the index would reject the 4th presence instead
 *    ("Nearby group is full and cannot be subdivided safely"). The test reports which happened.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runTravelResplitDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby travel and re-split on the map', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('a user travels A→B, two users move back into A, and A splits again (or rejects)', async () => {
    test.setTimeout(1_200_000);
    await clearGunForStage4Spec();
    demo = await runTravelResplitDemo(test.info(), 'map');
  });
});
