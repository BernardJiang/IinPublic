import { test as setup } from '../../helpers/fixtures';
import { loadStageSnapshot } from '../../helpers/e2e-stage-pipeline';

setup('load stage3 Gun snapshot', async () => {
  await loadStageSnapshot('stage3');
});
