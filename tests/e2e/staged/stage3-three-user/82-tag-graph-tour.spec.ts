/**
 * The tag graph tour in browsers: one tag walks every edge — place, people, Talks and answers.
 * The walk itself is `journeys/tag-graph-tour-journey.ts`, shared with phone-path/09.
 *
 * Companion doc: tests/e2e/staged/stage3-three-user/82-tag-graph-tour.md
 */
import { chromium, type Browser } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { tagGraphTourJourney } from '../../journeys/tag-graph-tour-journey';

test.describe('Tag graph tour', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
  });

  test.afterAll(async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage3Spec();
  });

  test('one tag walks every edge: place, people, Talks and answers', async () => {
    test.setTimeout(360_000);
    const launch = async (label: string, name: string) => {
      const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
      browsers.push(browser);
      return (await bootstrapUser(browser, label, name)).page;
    };
    const [ann, ben, cy] = await Promise.all([launch('Ann', 'Ann Tour'), launch('Ben', 'Ben Tour'), launch('Cy', 'Cy Tour')]);
    await tagGraphTourJourney(ann, ben, cy);
  });
});
