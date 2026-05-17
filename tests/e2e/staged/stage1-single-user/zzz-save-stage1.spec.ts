import { test } from '../../helpers/fixtures';
import { isStagePipeline, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';

test.describe('Stage 1 — save snapshot', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('persist server graph after single-user suite', async () => {
    await saveStageSnapshot('stage1');
  });
});
