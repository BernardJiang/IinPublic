import { chromium, expect } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline, loadStageSnapshot, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport, bootstrapAdam, bootstrapEve, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { afterSync } from '../../helpers/timing';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Stage 3 — Eve joins TechSupport and Adam', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('load stage2, Eve enters Global, headcount reflects three users', async () => {
    await loadStageSnapshot('stage2');
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=1600,800'] });
    const contexts = [];
    try {
      const tech = await bootstrapTechSupport(browser, 'TechSupport');
      const adam = await bootstrapAdam(browser, 'Adam');
      const eve = await bootstrapEve(browser, 'Eve');
      contexts.push(tech.context, adam.context, eve.context);
      for (const p of [tech.page, adam.page, eve.page]) {
        await p.click('.chatroom-item[data-chatroom-id="global"]');
      }
      await afterSync();
      await expect
        .poll(
          async () => {
            const text = (await eve.page.locator('.chatroom-item[data-chatroom-id="global"]').first().textContent()) || '';
            const match = text.match(/👥\s*(\d+)/);
            return match ? Number(match[1]) : 0;
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThanOrEqual(3);

      await saveUserStorageState(tech.context, 'stage3', 'techsupport');
      await saveUserStorageState(adam.context, 'stage3', 'adam');
      await saveUserStorageState(eve.context, 'stage3', 'eve');
      await saveStageSnapshot('stage3');
    } finally {
      await Promise.all(contexts.map((context) => context.close().catch(() => undefined)));
      await browser.close().catch(() => undefined);
    }
  });
});
