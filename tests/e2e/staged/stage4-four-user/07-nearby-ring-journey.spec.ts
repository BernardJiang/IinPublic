/**
 * Four people near each other in four browsers — the same journey body native-app/30 runs on real
 * phones (tests/e2e/journeys/nearby-ring-journey.ts, OPEN-59 step 3):
 *   J-NEARBY-01  everyone has the other three on their own Nearby list;
 *   J-NEARBY-02  each person's Talk reaches the next person in a ring.
 * J-NEARBY-03 (backgrounded receiver) needs the Android shell and stays on the phones.
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { clearGunForStage4Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import type { TestActor } from '../../helpers/test-actor';
import { everyoneListsEveryone, ringTalkJourney, type NearbyParticipant } from '../../journeys/nearby-ring-journey';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES = ['Adam', 'Eve', 'Bob', 'Alice'] as const;

test.describe('Four people nearby: personal lists and a Talk ring (shared with native-app/30)', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage4Spec();
  });

  test.afterAll(async () => {
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage4Spec();
  });

  test('J-NEARBY-01/02: everyone lists everyone, and each Talk reaches the next person', async () => {
    test.setTimeout(420_000);
    browsers.push(...await Promise.all(NAMES.map(() => chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] }))));
    const people: NearbyParticipant[] = [];
    for (const [index, name] of NAMES.entries()) {
      const { context, page } = await bootstrapUser(browsers[index], name, name, 30_000);
      contexts.push(context);
      pages.push(page);
      const userId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      const actor: TestActor = { id: name, runtime: 'browser', page };
      people.push({ actor, userId, stageName: name });
    }

    await everyoneListsEveryone(people);
    const deliveryMs = await ringTalkJourney(people, `stage4-nearby-ring-${Date.now()}`);
    test.info().annotations.push({ type: 'timing', description: `ring delivery ms: ${deliveryMs.join(', ')}` });
  });
});
