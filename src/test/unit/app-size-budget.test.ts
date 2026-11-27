import fs from 'fs';
import path from 'path';

// OPEN-104's first promoted slice moved the block-signal workflow into the portable core. This
// ratchet prevents unrelated work from putting those lines (or equivalent new policy) back into
// the application coordinator. Lower the budget after each extraction; do not raise it for
// ordinary feature work.
const APP_LINE_BUDGET = 10_555;

describe('IinPublicApp architecture budget', () => {
  it(`keeps app.ts at or below ${APP_LINE_BUDGET.toLocaleString()} lines`, () => {
    const sourcePath = path.resolve(process.cwd(), 'src/web/app/app.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const lineCount = source.trimEnd().split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(APP_LINE_BUDGET);
  });
});
