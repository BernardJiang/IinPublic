/**
 * List view: 3 + 1 users split the Nearby group down to the smallest region (~1 km), then switch
 * rooms by tapping rows — a full room cannot be entered, a room with space can. See
 * helpers/nearby-demo-scenarios.ts runMinimumSplitSwitchDemo for the exact steps.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runMinimumSplitSwitchDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby smallest region and room switching in the list view', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('3 + 1 users split to the smallest region; tapping rooms switches between them', async () => {
    test.setTimeout(1_500_000);
    await clearGunForStage4Spec();
    demo = await runMinimumSplitSwitchDemo(test.info());
  });
});
