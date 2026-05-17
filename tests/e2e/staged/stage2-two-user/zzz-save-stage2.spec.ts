import { test } from '../../helpers/fixtures';
import { isStagePipeline, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';

test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

test('save stage2 snapshot after two-user suite', async () => {
  await saveStageSnapshot('stage2');
});
