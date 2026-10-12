/**
 * Visual demo: one user's Nearby chatroom shrinks from the whole world to a local area (C = 3).
 *
 * docs/design/nearby-and-place-chatrooms.md §3: while the online population is at most C, everyone
 * shares one worldwide Nearby group. When C + 1 signed presences reach a group, the partition index
 * replaces it with four compact geographic groups, and each member follows the one covering its
 * declared location. Four users around San Diego keep landing in the same quarter, so the split
 * repeats level by level until the privacy floor; after that, identity lanes divide them.
 *
 * U1's window stays on the map view. Every time U1's Nearby room changes, the shaded green area
 * is captured (screenshot attachment) and the run is recorded as a video.
 */
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { runShrinkDemo } from '../../helpers/nearby-demo-scenarios';
import type { NearbyMapDemo } from '../../helpers/nearby-map-demo';

test.describe('Nearby shrink on the map', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('U1 watches its Nearby area shrink from worldwide to local as four users arrive', async () => {
    test.setTimeout(900_000);
    await clearGunForStage4Spec();
    demo = await runShrinkDemo(test.info(), 'map');
  });
});
