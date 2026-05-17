import { chromium } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline, loadStageSnapshot, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport, bootstrapAdam, bootstrapEve, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { afterSync } from '../../helpers/timing';
import { assertStatusChecks } from '../../helpers/e2e-status-checks';
import { headless } from '../../helpers/timing';

test.describe('Stage 3 — Eve joins TechSupport and Adam', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('load stage2, Eve enters Global, headcount reflects three users', async () => {
    await loadStageSnapshot('stage2');
    const browser = await chromium.launch({ headless, args: ['--window-position=0,0', '--window-size=1600,800'] });
    const tech = await bootstrapTechSupport(browser, 'TechSupport');
    const adam = await bootstrapAdam(browser, 'Adam');
    const eve = await bootstrapEve(browser, 'Eve');
    for (const p of [tech.page, adam.page, eve.page]) {
      await p.click('.chatroom-item[data-chatroom-id="global"]');
    }
    await afterSync();
    await assertStatusChecks(eve.page, [{ kind: 'chatroomHeadcount', roomId: 'global', count: 3 }]);

    await saveUserStorageState(tech.context, 'stage3', 'techsupport');
    await saveUserStorageState(adam.context, 'stage3', 'adam');
    await saveUserStorageState(eve.context, 'stage3', 'eve');
    await saveStageSnapshot('stage3');
    await tech.context.close();
    await adam.context.close();
    await eve.context.close();
    await browser.close();
  });
});
