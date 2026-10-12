/**
 * More than four users, list and map: three users share one smallest square (one worldwide room at
 * C = 3); five newcomers arrive, each closer than the last, and each forces the trio's room to split
 * until the newcomer separates. The last stands inside the trio's own smallest square — 4 people in
 * a region location cannot divide. Steps: helpers/nearby-demo-scenarios.ts runProgressiveSplitDemo.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runProgressiveSplitDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby progressive split with eight users', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('each closer newcomer splits the trio room again, down to the smallest region and beyond', async () => {
    test.setTimeout(2_400_000);
    await clearGunForStage4Spec();
    demo = await runProgressiveSplitDemo(test.info());
  });
});
