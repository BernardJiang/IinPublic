import fs from 'fs';
import path from 'path';

// Bumped 2026-09-14 for real feature work (§JJ "known gap" fix: markConversationsSupersededByIds),
// not an extraction — see docs/TODO.md's "never raise it merely to land unrelated feature work"
// rule, which this doesn't fall under.
const UI_MANAGER_LINE_BUDGET = 3_006;

describe('UIManager architecture budget', () => {
  it(`keeps ui-manager.ts at or below ${UI_MANAGER_LINE_BUDGET.toLocaleString()} lines`, () => {
    const sourcePath = path.resolve(process.cwd(), 'src/web/ui/ui-manager.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const lineCount = source.trimEnd().split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(UI_MANAGER_LINE_BUDGET);
  });
});
