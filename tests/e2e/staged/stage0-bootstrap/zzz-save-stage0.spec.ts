import { test } from '../../helpers/fixtures';
import { isStagePipeline, saveStageSnapshot } from '../../helpers/e2e-stage-pipeline';

test.describe('Stage 0 — save verified TechSupport baseline', () => {
  test.skip(!isStagePipeline(), 'only for E2E_STAGE_PIPELINE=1');

  test('persist server graph after TechSupport single-user traversal', async () => {
    await saveStageSnapshot('stage0');
  });
});

