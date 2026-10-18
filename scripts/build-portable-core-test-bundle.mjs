// Builds the device test bundles under dist/device-tests/:
//   portable-core-webview.js / portable-core-node.cjs   the hand-written contracts
//                                                        (src/shared/portable-core-contracts.ts)
//   portable-jest-webview.js / portable-jest-node.cjs   real Jest files from src/test/unit, run
//                                                        unchanged by src/test/support/portable-jest
// The Jest files are the ones listed in src/test/support/portable-jest/suites.json. Refresh that
// list with `node scripts/build-portable-core-test-bundle.mjs --select`: it takes every unit file
// that uses no module mocks, Node built-ins, DOM, or server imports, then drops (with the reason)
// any that does not bundle for an old WebView or embedded Node, or does not pass in host Node and
// headless Chromium under the portable runtime. Excluded files stay host-only; never half-run.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { runPortableJestNodeBundle } from './lib/portable-jest-node-worker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repoRoot, 'dist', 'device-tests');
const suitesPath = path.join(repoRoot, 'src', 'test', 'support', 'portable-jest', 'suites.json');
const unitDirectory = path.join(repoRoot, 'src', 'test', 'unit');
// The oldest WebView in the phone matrix (Honor FRD, Android 7) is Chrome 61. No polyfills: a
// built-in an old phone lacks is a real failure on that phone.
const WEBVIEW_TARGET = 'chrome61';
await mkdir(outputDirectory, { recursive: true });

function entrySource(files, kind) {
  const lines = [
    // The app loads gun before gun/sea (src/web/sea-gun.ts), so SEA finds window.Gun instead of
    // its dynamic require('./gun'), which a bundle cannot follow. Embedded Node requires gun.
    ...(kind === 'webview' ? ["import 'gun';"] : []),
    "import './src/test/support/portable-jest/register';",
    "import { beginFile, fileLoadFailed, runPortableJest, setHostOnlyTests } from './src/test/support/portable-jest/runtime';",
    `setHostOnlyTests(${JSON.stringify(Object.keys(HOST_ONLY_TESTS))});`,
  ];
  for (const file of files) {
    lines.push(`beginFile(${JSON.stringify(file)});`);
    lines.push(`try { require(${JSON.stringify(`./src/test/unit/${file}`)}); } catch (error) { fileLoadFailed(error); }`);
  }
  lines.push('export { runPortableJest };');
  lines.push("if (typeof window !== 'undefined') (window as any).__iinpublicPortableJest = { schemaVersion: 1, run: runPortableJest };");
  return lines.join('\n');
}

function jestBuild(files, kind, write = true) {
  const webview = kind === 'webview';
  return build({
    stdin: { contents: entrySource(files, kind), resolveDir: repoRoot, sourcefile: 'portable-jest-entry.ts', loader: 'ts' },
    outfile: path.join(outputDirectory, webview ? 'portable-jest-webview.js' : 'portable-jest-node.cjs'),
    bundle: true,
    format: webview ? 'iife' : 'cjs',
    platform: webview ? 'browser' : 'node',
    target: webview ? [WEBVIEW_TARGET] : ['node18'],
    sourcemap: write,
    write,
    logLevel: 'silent',
    // Embedded Node ships gun in nodejs-project/node_modules; gun's own dynamic requires do not
    // survive bundling. The WebView bundle includes gun/sea like the app's webpack build does.
    ...(webview
      ? { inject: [path.join(repoRoot, 'src/test/support/portable-jest/process-shim.ts')] }
      : { external: ['gun', 'gun/*'] }),
  });
}

async function contractBundles() {
  await Promise.all([
    build({
      entryPoints: [path.join(repoRoot, 'src/test/support/portable-core-webview-entry.ts')],
      outfile: path.join(outputDirectory, 'portable-core-webview.js'),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome101'],
      sourcemap: true,
      logLevel: 'warning',
    }),
    build({
      entryPoints: [path.join(repoRoot, 'src/test/support/portable-core-node-entry.ts')],
      outfile: path.join(outputDirectory, 'portable-core-node.cjs'),
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: ['node18'],
      sourcemap: true,
      logLevel: 'warning',
    }),
  ]);
}

// ------------------------------------------------------------------------------------ --select

const NODE_BUILTINS = /from ['"](node:|fs|path|os|crypto|child_process|http|https|net|url|util|events|zlib|stream|worker_threads|perf_hooks)['"/]/;

// Scale simulations answer a host question and take seconds even on the Mac
// (docs/testing/android-core-test-plan.md: scale tests stay host-side).
const HOST_ONLY_BY_DESIGN = {
  'room-topology-million.test.ts': 'scale simulation: host-only by design',
  'nearby-capacity-simulation.test.ts': 'scale simulation: host-only by design',
  'nearby-adaptive-capacity.test.ts': 'scale simulation: host-only by design',
};

// Single tests skipped on phones (reported as skipped, so their ids still match the host): timing
// budgets calibrated on the Mac. The rest of each file runs.
const HOST_ONLY_TESTS = {
  'find-similar.test.ts › find-similar §4 — scale to ~100k (REQ-SIM-NFR-01/02/05) › top-K over a 100k population is fast, bounded, and never O(N²)':
    'host-calibrated 1 s budget over a 100k population (1,051 ms on the C10, 2026-10-17)',
};

// jest.* the portable runtime provides (src/test/support/portable-jest/mocks.ts). Mock/Mocked/
// MockedFunction/SpyInstance are types only.
const PORTABLE_JEST_APIS = new Set([
  'fn', 'spyOn', 'isMockFunction', 'clearAllMocks', 'resetAllMocks', 'restoreAllMocks', 'setTimeout',
  'useFakeTimers', 'useRealTimers', 'advanceTimersByTime', 'advanceTimersByTimeAsync', 'runAllTimers',
  'runAllTimersAsync', 'runOnlyPendingTimers', 'runOnlyPendingTimersAsync', 'clearAllTimers',
  'getTimerCount', 'setSystemTime', 'getRealSystemTime', 'now',
  'Mock', 'Mocked', 'MockedFunction', 'MockedObject', 'SpyInstance', 'MockInstance', 'Spied',
]);

function staticExclusion(source) {
  const unsupported = [...new Set([...source.matchAll(/\bjest\.(\w+)/g)].map((match) => match[1]))]
    .filter((api) => !PORTABLE_JEST_APIS.has(api));
  if (unsupported.length) return `uses jest.${unsupported.join(', jest.')} (module mocks stay host-only)`;
  if (NODE_BUILTINS.test(source)) return 'imports a Node built-in';
  if (/\brequire\(/.test(source)) return 'uses require()';
  if (/@testing-library|jsdom|@jest-environment/.test(source)) return 'needs a DOM test environment';
  if (/\b(document|window|localStorage|navigator)\./.test(source)) return 'uses the DOM or browser globals';
  // Web code is what the app's WebView runs anyway; whether it also runs in embedded Node is
  // decided by actually running it below. Server code never runs on a phone.
  if (/from ['"]\.\.\/\.\.\/server\//.test(source)) return 'imports server code';
  if (/from ['"]\.\.\/(support|helpers|fixtures)\//.test(source)) return 'imports host test helpers';
  return '';
}

async function hostReport(files) {
  await jestBuild(files, 'node');
  return runPortableJestNodeBundle(path.join(outputDirectory, 'portable-jest-node.cjs'));
}

async function chromiumReport(files) {
  await jestBuild(files, 'webview');
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // A localhost origin is a secure context (crypto.subtle), like the app's http://127.0.0.1:8088.
    await page.route('http://localhost/portable-jest', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>portable jest</title>' }));
    await page.goto('http://localhost/portable-jest');
    await page.addScriptTag({ path: path.join(outputDirectory, 'portable-jest-webview.js') });
    return await page.evaluate(() => window.__iinpublicPortableJest.run());
  } finally {
    await browser.close();
  }
}

/** Test ids host Jest reports for these files ("describe › … › test"), keyed by file name. */
async function realJestIds(files) {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const output = path.join(tmpdir(), `portable-jest-select-${process.pid}.json`);
  spawnSync(path.join(repoRoot, 'node_modules', '.bin', 'jest'), [
    '--json', `--outputFile=${output}`, ...files.map((file) => `src/test/unit/${file}`),
  ], { cwd: repoRoot, stdio: 'ignore' });
  const report = JSON.parse(await readFile(output, 'utf8'));
  const ids = new Map();
  for (const result of report.testResults) {
    const file = path.basename(result.name);
    ids.set(file, result.assertionResults.map((assertion) => [...assertion.ancestorTitles, assertion.title].join(' › ')));
  }
  return ids;
}

async function select() {
  const all = (await readdir(unitDirectory)).filter((file) => file.endsWith('.test.ts')).sort();
  const excluded = [];
  let included = [];
  for (const file of all) {
    const reason = HOST_ONLY_BY_DESIGN[file] || staticExclusion(await readFile(path.join(unitDirectory, file), 'utf8'));
    if (reason) excluded.push({ file, reason });
    else included.push(file);
  }
  for (const file of [...included]) {
    for (const [kind, target] of [['webview', WEBVIEW_TARGET], ['node', 'embedded Node']]) {
      try {
        const result = await jestBuild([file], kind, false);
        // Embedded Node on the phones has no ICU: a /\p{L}/u literal anywhere in the bundle is a
        // syntax error that stops every file from loading (1.0.161). `new RegExp('\\p{L}')` inside
        // a try, as src/shared/reputation.ts does, is fine; that form is a string, not a literal.
        if (kind === 'node' && /(^|[^\\])\\p\{/.test(result.outputFiles[0].text)) {
          throw new Error('a Unicode property escape (\\p{...}) regex literal, which embedded Node without ICU cannot compile');
        }
      } catch (error) {
        const message = error?.errors?.[0]?.text || String(error);
        excluded.push({ file, reason: `does not bundle for ${target}: ${message}` });
        included = included.filter((name) => name !== file);
        break;
      }
    }
  }
  // Repeat until nothing more fails: a file that throws while loading a shared module (gun's
  // dynamic requires) leaves that module half-initialized, and the next file to import it can
  // then pass by accident. Removing the first file exposes the second.
  for (let changed = true; changed;) {
    changed = false;
    for (const [runtime, run] of [['host Node as embedded Node 18', hostReport], ['headless Chromium', chromiumReport]]) {
      const report = await run(included);
      for (const fileReport of report.reports.filter((entry) => entry.failed > 0)) {
        const first = fileReport.results.find((result) => !result.passed);
        excluded.push({ file: fileReport.file, reason: `fails under the portable runtime in ${runtime}: ${first.id}: ${first.error}` });
        included = included.filter((name) => name !== fileReport.file);
        changed = true;
      }
    }
  }
  // The phones must report exactly host Jest's test ids (native-app/34). A name the portable
  // runtime formats differently (Jest prints `%o` with Node's util.inspect) keeps its file host-only.
  const jestIds = await realJestIds(included);
  const portableIds = await hostReport(included);
  for (const fileReport of portableIds.reports) {
    const mine = fileReport.results.map((result) => result.id).sort();
    const theirs = (jestIds.get(fileReport.file) || []).sort();
    if (JSON.stringify(mine) === JSON.stringify(theirs)) continue;
    const differing = mine.find((id) => !theirs.includes(id)) || theirs.find((id) => !mine.includes(id));
    excluded.push({ file: fileReport.file, reason: `test ids differ from host Jest: ${differing}` });
    included = included.filter((name) => name !== fileReport.file);
  }
  excluded.sort((a, b) => a.file.localeCompare(b.file));
  await writeFile(suitesPath, `${JSON.stringify({
    comment: 'Unit files run unchanged on phones by src/test/support/portable-jest. Regenerate: node scripts/build-portable-core-test-bundle.mjs --select',
    included,
    excluded,
    hostOnlyTests: HOST_ONLY_TESTS,
  }, null, 2)}\n`);
  process.stdout.write(`[android-core] ${included.length} of ${all.length} unit files are portable; ${excluded.length} stay host-only (${path.relative(repoRoot, suitesPath)})\n`);
}

// ------------------------------------------------------------------------------------- main

if (process.argv.includes('--select')) await select();
const { included } = JSON.parse(await readFile(suitesPath, 'utf8'));
await Promise.all([contractBundles(), jestBuild(included, 'webview'), jestBuild(included, 'node')]);
process.stdout.write(`[android-core] built portable bundles (6+ contracts, ${included.length} Jest files) in ${path.relative(repoRoot, outputDirectory)}\n`);
