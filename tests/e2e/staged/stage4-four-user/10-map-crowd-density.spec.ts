/**
 * Visual demo: people and crowd density on the map.
 *
 * Two real users (U1 watching, U2 next to them in the same Nearby room) plus ~300 synthetic users
 * who publish signed map presences through the real API: a dense crowd downtown, a smaller one in
 * La Jolla, and a light scatter across the county. U1's map shows ★ for U1, a green dot for U2
 * (same room: can exchange Talks), yellow dots for everyone else, and a heat layer for density.
 * U1 zooms from the world down to the city; each zoom level is captured.
 */
import SEA from 'gun/sea';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { gunBaseURL } from '../../helpers/ports';
import { NearbyMapDemo, SAN_DIEGO_SPOTS, caption, openMap } from '../../helpers/nearby-map-demo';
import { createMapPresence } from '../../../../src/shared/map-presence';
import { publicLocationFor } from '../../../../src/shared/public-location';
import type { SeaSigningPair } from '../../../../src/shared/p2p-runtime';

const CROWDS = [
  { name: 'downtown', latitude: 32.7157, longitude: -117.1611, spreadKm: 1.5, people: 180 },
  { name: 'La Jolla', latitude: 32.8328, longitude: -117.2713, spreadKm: 1.2, people: 80 },
  { name: 'county', latitude: 32.85, longitude: -117.0, spreadKm: 18, people: 40 },
];

/** Deterministic pseudo-random normal offsets, so every run draws the same crowd. */
function* gaussian(seed: number): Generator<number> {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return (state + 1) / 2_147_483_649;
  };
  for (;;) yield Math.sqrt(-2 * Math.log(next())) * Math.cos(2 * Math.PI * next());
}

test.describe('Crowd density on the map', () => {
  let demo: NearbyMapDemo | undefined;

  test.afterAll(async () => {
    await demo?.close();
    await clearGunForStage4Spec();
  });

  test('U1 sees ★ itself, a green roommate, yellow strangers and a density heat map', async ({ request }) => {
    test.setTimeout(600_000);
    await clearGunForStage4Spec();
    demo = new NearbyMapDemo(test.info(), '/');

    const u1 = await demo.boot('U1', SAN_DIEGO_SPOTS[0]!, 0, true);
    const u2 = await demo.boot('U2', SAN_DIEGO_SPOTS[1]!, 0, false);
    await openMap(u1);

    // Publish the synthetic crowd through the real, signed endpoint.
    const random = gaussian(42);
    let published = 0;
    for (const crowd of CROWDS) {
      for (let i = 0; i < crowd.people; i++) {
        const kmNorth = random.next().value * crowd.spreadKm;
        const kmEast = random.next().value * crowd.spreadKm;
        const location = publicLocationFor({
          latitude: crowd.latitude + kmNorth / 111.32,
          longitude: crowd.longitude + kmEast / (111.32 * Math.cos((crowd.latitude * Math.PI) / 180)),
          accuracy: 10,
        }, 'neighborhood')!;
        const pair = await SEA.pair() as SeaSigningPair;
        const presence = await createMapPresence({ userId: `crowd-${crowd.name}-${i}`, pair, location });
        const response = await request.post(`${gunBaseURL()}/api/map-presence`, { data: { presence } });
        expect(response.ok(), await response.text()).toBe(true);
        published++;
      }
    }
    console.log(`[crowd] published ${published} synthetic map presences`);

    const map = u1.locator('[data-testid="chatroom-map"]');
    // The worldwide Nearby area opens the map on [0°, 20°]; drag America into view (≈ 5.7 px/° at zoom 2).
    const view = (await map.boundingBox())!;
    await u1.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
    await u1.mouse.down();
    await u1.mouse.move(view.x + view.width / 2 + 520, view.y + view.height / 2 - 40, { steps: 20 });
    await u1.mouse.up();
    // Both real users publish within a second of boot; wait until U1 sees itself and U2.
    await expect(map.locator('[data-testid="map-user-dot-self"]')).toHaveCount(1, { timeout: 60_000 });
    await expect(map.locator('[data-testid="map-user-dot-room"]')).toHaveCount(1, { timeout: 90_000 });
    void u2;

    // Zoom with the wheel on my star: MapLibre keeps the point under the cursor fixed.
    const star = map.locator('[data-testid="map-user-dot-self"]');
    const levels: Array<{ label: string; steps: number }> = [
      { label: 'world: one hot spot over San Diego', steps: 0 },
      { label: 'region: crowds start to separate', steps: 8 },
      { label: 'county: downtown vs La Jolla vs scatter', steps: 6 },
      { label: 'city: individual 1 km squares', steps: 5 },
    ];
    for (const level of levels) {
      if (level.steps > 0) {
        const box = (await star.boundingBox())!;
        await u1.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < level.steps; i++) {
          await u1.mouse.wheel(0, -400);
          await u1.waitForTimeout(250);
        }
      }
      await u1.waitForTimeout(2_000); // debounce + query + heat redraw
      await caption(u1, level.label);
      await demo.capture(u1, 'U1', level.label);
    }

    expect(Number(await map.getAttribute('data-user-density-cells'))).toBeGreaterThan(0);
    await expect(map.locator('[data-testid="map-user-dot-other"]').first()).toBeVisible();
    console.log(`[summary]\n${demo.summary()}`);
  });
});
