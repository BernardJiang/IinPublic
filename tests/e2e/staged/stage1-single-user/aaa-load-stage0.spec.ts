import { test } from '../../helpers/fixtures';
import { isStagePipeline, loadStageSnapshot } from '../../helpers/e2e-stage-pipeline';

test.describe('Stage 1 — load stage0', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('import stage0 snapshot before single-user tests', async () => {
    await loadStageSnapshot('stage0');
  });
});
