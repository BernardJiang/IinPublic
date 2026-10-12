/**
 * List-view twin of 09-nearby-travel-resplit-map: after the cascade (A = 3, B = 1), one user travels
 * A → B (2 / 2, no split), then two users move back into A (4 > 3) and A splits again. Each step
 * saves one 2×2 frame of all four users' lists. Travel itself still taps the map (the list has no
 * point to tap), then switches straight back to the list.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runTravelResplitDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby travel and re-split in the list view', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('the lists show A→B travel, the move back, and A splitting again', async () => {
    test.setTimeout(1_200_000);
    await clearGunForStage4Spec();
    demo = await runTravelResplitDemo(test.info(), 'list');
  });
});
