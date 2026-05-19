import { test } from '../../helpers/fixtures';
import { isStagePipeline, saveStage2SnapshotFromAdamJoinBaseline } from '../../helpers/e2e-stage-pipeline';

test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

test('save stage2 snapshot after two-user suite', async () => {
  await saveStage2SnapshotFromAdamJoinBaseline();
});
