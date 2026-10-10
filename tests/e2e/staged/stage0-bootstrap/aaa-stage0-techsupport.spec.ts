import { chromium } from '@playwright/test';
import { test } from '../../helpers/fixtures';
import { isStagePipeline } from '../../helpers/e2e-stage-pipeline';
import { resetToStage0Empty } from '../../helpers/e2e-stage-pipeline';
import { bootstrapTechSupport, saveUserStorageState } from '../../helpers/bootstrap-canonical';
import { assertStatusChecks } from '../../helpers/e2e-status-checks';
import { headless } from '../../helpers/timing';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Stage 0 — empty database, contacts-only TechSupport', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('clears Gun and logs in TechSupport without room presence', async () => {
    await resetToStage0Empty();
    const browser = await chromium.launch({ headless, args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0'] });
    const { context, page } = await bootstrapTechSupport(browser);
    await assertStatusChecks(page, [
      { kind: 'statusBarRoom', substring: 'Contacts only' },
    ]);
    await saveUserStorageState(context, 'stage0', 'techsupport');
    await context.close();
    await browser.close();
  });
});
