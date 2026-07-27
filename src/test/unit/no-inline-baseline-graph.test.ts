import fs from 'fs';
import path from 'path';

/**
 * Guard for docs/TODO.md K4: stage0 is the only place a database is built from scratch.
 * Every other spec must go through `maybeClearGunDatabases`/`clearGunDatabases` (which now loads
 * the committed `stage0.fixture.json`, see clear-database.ts), never construct or reach for the
 * raw graph factory itself.
 */

function listSpecFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSpecFiles(full));
    } else if (entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('no spec builds the TechSupport baseline graph from scratch', () => {
  it('no .spec.ts outside stage0-bootstrap/ references the raw graph factory or seeds directly', () => {
    const e2eRoot = path.join(process.cwd(), 'tests/e2e');
    const offenders: string[] = [];
    for (const file of listSpecFiles(e2eRoot)) {
      if (file.includes(`${path.sep}stage0-bootstrap${path.sep}`)) continue;
      const content = fs.readFileSync(file, 'utf8');
      if (content.includes('techSupportBaselineGraph') || content.includes('seedTechSupportRootBaseline')) {
        offenders.push(path.relative(process.cwd(), file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
