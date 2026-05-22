import { test } from '../../helpers/fixtures';
import { isStagePipeline } from '../../helpers/e2e-stage-pipeline';

test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

test('save stage3 snapshot after three-user suite', async () => {
  // Stage 3 is saved by 00-aaa immediately after Eve joins the canonical baseline.
  // Later specs intentionally reset to the TechSupport baseline, so saving here would overwrite it.
});
