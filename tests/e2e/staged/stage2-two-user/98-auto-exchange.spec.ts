/**
 * Automatic Talk exchange in browsers (OPEN-112): no Broadcast step; making a Talk public is the
 * only action, and the chatbot answers what it has learnt. The journey is
 * `journeys/auto-exchange-journey.ts`, shared with native-app/42 on two real phones.
 *
 * Companion doc: tests/e2e/staged/stage2-two-user/98-auto-exchange.md
 */
import { chromium, type Browser } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { autoExchangeJourney } from '../../journeys/auto-exchange-journey';

test.describe('Automatic Talk exchange', () => {
  test.describe.configure({ retries: 0 });
  const browsers: Browser[] = [];

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
  });

  test.afterAll(async () => {
    await Promise.all(browsers.map((browser) => browser.close().catch(() => {})));
    await clearGunForStage2Spec();
  });

  test('a published Talk arrives with no tap, and the chatbot answers the next one', async () => {
    test.setTimeout(360_000);
    const launch = async (label: string, name: string) => {
      const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS] });
      browsers.push(browser);
      return { id: label, runtime: 'browser' as const, page: (await bootstrapUser(browser, label, name)).page };
    };
    const alice = await launch('Alice', 'Alice Auto');
    const bob = await launch('Bob', 'Bob Auto');
    await autoExchangeJourney(alice, bob);
  });
});
