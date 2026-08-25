import fs from 'fs';
import path from 'path';

const UI_MANAGER_LINE_BUDGET = 10_830;

describe('UIManager architecture budget', () => {
  it(`keeps ui-manager.ts at or below ${UI_MANAGER_LINE_BUDGET.toLocaleString()} lines`, () => {
    const sourcePath = path.resolve(process.cwd(), 'src/web/ui/ui-manager.ts');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const lineCount = source.trimEnd().split(/\r?\n/).length;

    expect(lineCount).toBeLessThanOrEqual(UI_MANAGER_LINE_BUDGET);
  });
});
