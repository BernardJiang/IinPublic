import { test } from '../../helpers/fixtures';
import { isStagePipeline, saveStage1SnapshotFromStage0Baseline } from '../../helpers/e2e-stage-pipeline';

test.describe('Stage 1 — save snapshot', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('persist server graph after single-user suite', async () => {
    await saveStage1SnapshotFromStage0Baseline();
  });
});
