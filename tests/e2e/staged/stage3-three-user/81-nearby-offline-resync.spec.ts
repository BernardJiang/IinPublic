/**
 * Three people near each other in three browsers — the same journey body native-app/13 runs on
 * real phones (tests/e2e/journeys/nearby-ring-journey.ts, OPEN-59 step 3):
 *   J-NEARBY-04  all three send Talks at once and each receives the other two;
 *   J-NEARBY-05  Bob goes offline, Adam and Eve keep answering each other, and the Talk Adam sent
 *                Bob while he was away arrives once he is back.
 * A browser context's offline switch cuts HTTP and the hub but not necessarily an open WebRTC
 * channel, so the strict "arrived only after return" proof is the phones' (Wi-Fi off).
 */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { clearGunForStage3Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import type { TestActor } from '../../helpers/test-actor';
import { everyoneListsEveryone, offlineResyncJourney, type NearbyParticipant } from '../../journeys/nearby-ring-journey';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NAMES = ['Adam', 'Eve', 'Bob'] as const;

test.describe('Three people nearby: concurrent Talks, one offline, catch-up on return (shared with native-app/13)', () => {
  const browsers: Browser[] = [];
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage3Spec();
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map((context) => context.setOffline(false).catch(() => {})));
    await Promise.all(pages.map((page) =>
      page.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {})));
    await Promise.all(contexts.map((context) => context.close().catch(() => {})));
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage3Spec();
  });

  test('J-NEARBY-04/05: concurrent Talks; Bob misses one while offline and gets it back', async () => {
    test.setTimeout(420_000);
    browsers.push(...await Promise.all(NAMES.map(() => chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] }))));
    const people: NearbyParticipant[] = [];
    for (const [index, name] of NAMES.entries()) {
      const { context, page } = await bootstrapUser(browsers[index], name, name, 30_000);
      contexts.push(context);
      pages.push(page);
      const userId = await page.evaluate(() => String((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id || ''));
      const actor: TestActor = { id: name, runtime: 'browser', page, setOffline: (offline) => context.setOffline(offline) };
      people.push({ actor, userId, stageName: name });
    }

    await everyoneListsEveryone(people);
    await offlineResyncJourney(people, people[2], `stage3-nearby-resync-${Date.now()}`);
  });
});
