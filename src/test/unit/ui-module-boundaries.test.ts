import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const UI_DIR = path.resolve(process.cwd(), 'src/web/ui');
const REVIEWABLE_MODULE_LINE_BUDGET = 1_200;
// Static localization catalog rather than executable UI ownership; size tracks language coverage.
const SIZE_BUDGET_EXEMPTIONS = new Set(['ui-translations.ts']);

function uiSourceFiles(): string[] {
  return fs.readdirSync(UI_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'ui-manager.ts')
    .sort();
}

function localImports(filename: string): string[] {
  const sourcePath = path.join(UI_DIR, filename);
  const sourceFile = ts.createSourceFile(
    sourcePath,
    fs.readFileSync(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  return sourceFile.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('./')) return [];
    const candidate = `${path.resolve(UI_DIR, specifier)}.ts`;
    return fs.existsSync(candidate) ? [path.basename(candidate)] : [];
  });
}

describe('extracted UI module boundaries', () => {
  it(`keeps every extracted module at or below ${REVIEWABLE_MODULE_LINE_BUDGET.toLocaleString()} lines`, () => {
    const oversized = uiSourceFiles().filter((filename) => !SIZE_BUDGET_EXEMPTIONS.has(filename)).flatMap((filename) => {
      const lines = fs.readFileSync(path.join(UI_DIR, filename), 'utf8').trimEnd().split(/\r?\n/).length;
      return lines > REVIEWABLE_MODULE_LINE_BUDGET ? [`${filename}: ${lines}`] : [];
    });

    expect(oversized).toEqual([]);
  });

  it('does not let extracted modules import or reach back through UIManager', () => {
    const managerImports = uiSourceFiles().flatMap((filename) =>
      localImports(filename).includes('ui-manager.ts') ? [filename] : [],
    );

    expect(managerImports).toEqual([]);
  });

  it('keeps the local UI dependency graph acyclic', () => {
    const files = uiSourceFiles();
    const graph = new Map(files.map((filename) => [
      filename,
      localImports(filename).filter((dependency) => dependency !== 'ui-manager.ts'),
    ]));
    const active = new Set<string>();
    const complete = new Set<string>();
    const cycles: string[] = [];

    const visit = (filename: string, trail: string[]): void => {
      if (active.has(filename)) {
        const cycleStart = trail.indexOf(filename);
        cycles.push([...trail.slice(cycleStart), filename].join(' -> '));
        return;
      }
      if (complete.has(filename)) return;
      active.add(filename);
      for (const dependency of graph.get(filename) || []) visit(dependency, [...trail, filename]);
      active.delete(filename);
      complete.add(filename);
    };

    for (const filename of files) visit(filename, []);
    expect(cycles).toEqual([]);
  });
});
