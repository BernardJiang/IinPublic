import { chromium, expect } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline, loadStageSnapshot, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTom, bootstrapAdam, bootstrapEve, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { afterSync } from '../../helpers/timing';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Stage 3 — Eve joins Tom and Adam', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('load stage2, Eve enters Nearby, headcount reflects three ordinary users', async () => {
    await loadStageSnapshot('stage2');
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=1600,800'] });
    const contexts = [];
    try {
      const tom = await bootstrapTom(browser, 'Tom');
      const adam = await bootstrapAdam(browser, 'Adam');
      const eve = await bootstrapEve(browser, 'Eve');
      contexts.push(tom.context, adam.context, eve.context);
      for (const p of [tom.page, adam.page, eve.page]) {
        await p.click('.chatroom-item.current-room');
      }
      await afterSync();
      await expect
        .poll(
          async () => {
            const text = (await eve.page.locator('.chatroom-item.current-room').first().textContent()) || '';
            const match = text.match(/👥\s*(\d+)/);
            return match ? Number(match[1]) : 0;
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThanOrEqual(3);

      await saveUserStorageState(tom.context, 'stage3', 'tom');
      await saveUserStorageState(adam.context, 'stage3', 'adam');
      await saveUserStorageState(eve.context, 'stage3', 'eve');
      await saveStageSnapshot('stage3');
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      await browser.close().catch(() => undefined);
    }
  });
});
