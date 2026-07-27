import fs from 'fs';
import { stage0FixturePath } from '../../../tests/e2e/helpers/clear-database';
import { assertStageSnapshotIntegrity } from '../../../tests/e2e/helpers/e2e-stage-pipeline';

/**
 * Guard for docs/TODO.md K4: the committed stage0 fixture (regenerated with
 * `npm run test:e2e:regen-stage0-fixture`) is what every E2E reset path restores instead of
 * building a graph in code. A bad regeneration must fail fast here, not only in a slow E2E run.
 */
describe('committed stage0 fixture', () => {
  it('exists and passes the same integrity check the stage pipeline enforces', async () => {
    const file = stage0FixturePath();
    expect(fs.existsSync(file)).toBe(true);
    const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    await expect(assertStageSnapshotIntegrity('stage0', snapshot)).resolves.toBeUndefined();
  });
});
