/**
 * OPEN-91: the device core runs in a web worker today and in the native Node process later, so it
 * must not reach into the GUI. Every module under src/core/ imports only src/core/ and src/shared/
 * and uses no page globals; src/core/host/ alone may use its host's APIs (the worker scope,
 * IndexedDB).
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const CORE = join(__dirname, '../../core');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('the device core’s boundary', () => {
  const modules = files(CORE);

  it('has modules to check', () => {
    expect(modules.length).toBeGreaterThan(10);
  });

  it.each(modules.map((path) => [relative(CORE, path), path]))('%s imports only the core and shared code', (_name, path) => {
    const source = readFileSync(path, 'utf8');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]!);
    for (const target of imports) {
      if (!target.startsWith('.')) continue; // packages
      expect(target).not.toMatch(/(^|\/)web\//);
      expect(target).not.toMatch(/(^|\/)server\//);
    }
  });

  it.each(modules.filter((path) => !relative(CORE, path).startsWith('host')).map((path) => [relative(CORE, path), path]))(
    '%s uses no page globals',
    (_name, path) => {
      // Comments may name them; code may not.
      const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\b(document|window|localStorage|sessionStorage|navigator|indexedDB)\b/);
    },
  );
});
