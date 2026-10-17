// One report for a whole Android sweep, like test:all. Every Playwright step writes a blob
// (E2E_BLOB=1; both configs file it under blob-report/<E2E_RUN_ID>/) and every step, Playwright or
// not, appends a line to a shared steps file. The script that started the sweep owns the report:
// at the end it prints every step's result and merges all blobs into one HTML report. Before this,
// each step's 'list' or 'html' output overwrote the last, so only the final step was reported.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ANDROID_REPORT_DIR = path.join(root, 'playwright-report-android');

let owner = false;
let startedAt = 0;

/** Join the sweep report a parent started, or start one. Call before spawning any step. */
export function beginSweepReport(name) {
  if (process.env.ANDROID_SWEEP_STEPS_FILE) return;
  owner = true;
  startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
  const runId = `${name}-${stamp}`;
  const runDir = path.join(root, 'blob-report', runId);
  fs.mkdirSync(runDir, { recursive: true });
  process.env.E2E_BLOB = '1';
  process.env.E2E_RUN_ID = runId;
  process.env.ANDROID_SWEEP_STEPS_FILE = path.join(runDir, 'steps.jsonl');
}

/** Playwright reporter flags: none while blobs are on (the configs add 'list' beside 'blob'). */
export function listReporterArgs() {
  return process.env.E2E_BLOB === '1' ? [] : ['--reporter=list'];
}

export function recordStep(phase, label, ok, stepStartedAt, detail = '') {
  const file = process.env.ANDROID_SWEEP_STEPS_FILE;
  if (!file) return;
  const line = { phase, label, ok, seconds: Math.round((Date.now() - stepStartedAt) / 1000), detail };
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
}

function readSteps() {
  const file = process.env.ANDROID_SWEEP_STEPS_FILE;
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60);
  return m ? `${m}m${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
}

/** merge-reports silently writes nothing under Node majors newer than Playwright supports (26). */
function mergeNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major <= 24) return process.execPath;
  const home = process.env.HOME || '';
  for (const m of [24, 22, 20, 18]) {
    for (const candidate of [`/opt/homebrew/opt/node@${m}/bin/node`, `/usr/local/opt/node@${m}/bin/node`]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    const nvm = path.join(home, '.nvm', 'versions', 'node');
    const version = fs.existsSync(nvm) ? fs.readdirSync(nvm).filter((v) => v.startsWith(`v${m}.`)).sort().at(-1) : '';
    if (version) return path.join(nvm, version, 'bin', 'node');
  }
  const cache = path.join(root, '.cache', 'node-merge');
  const cached = fs.existsSync(cache) ? fs.readdirSync(cache).sort().at(-1) : '';
  if (cached && fs.existsSync(path.join(cache, cached, 'bin', 'node'))) return path.join(cache, cached, 'bin', 'node');
  return '';
}

function mergeBlobs() {
  const runDir = path.join(root, 'blob-report', process.env.E2E_RUN_ID || '');
  const zips = fs.existsSync(runDir)
    ? fs.readdirSync(runDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => fs.readdirSync(path.join(runDir, entry.name))
        .filter((file) => file.endsWith('.zip'))
        .map((file) => path.join(runDir, entry.name, file)))
    : [];
  if (!zips.length) {
    console.log('[android-report] no Playwright step produced a blob; there is no HTML report to merge.');
    return;
  }
  const mergeDir = path.join(root, 'blob-merged', process.env.E2E_RUN_ID || 'android');
  fs.rmSync(mergeDir, { recursive: true, force: true });
  fs.mkdirSync(mergeDir, { recursive: true });
  for (const zip of zips) fs.copyFileSync(zip, path.join(mergeDir, path.basename(zip)));
  const node = mergeNode();
  if (!node) {
    console.log(`[android-report] Node ${process.versions.node} cannot run merge-reports and no Node 18-24 was found.`);
    console.log(`[android-report]   Install one (brew install node@22) and run: node node_modules/playwright/cli.js merge-reports --reporter html ${mergeDir}`);
    return;
  }
  fs.rmSync(ANDROID_REPORT_DIR, { recursive: true, force: true });
  // The X3 step uses the root config (testDir tests/e2e) and the rest the native-app config;
  // merge-reports refuses mixed test directories unless a config names one that holds both.
  const mergeConfig = path.join(root, 'blob-merged', `${process.env.E2E_RUN_ID || 'android'}.merge.config.mjs`);
  fs.writeFileSync(mergeConfig, `export default { testDir: ${JSON.stringify(path.join(root, 'tests', 'e2e'))} };\n`);
  const result = spawnSync(node, [path.join(root, 'node_modules', 'playwright', 'cli.js'), 'merge-reports', '-c', mergeConfig, '--reporter', 'html', mergeDir], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: ANDROID_REPORT_DIR, PLAYWRIGHT_HTML_OPEN: 'never' },
  });
  const index = path.join(ANDROID_REPORT_DIR, 'index.html');
  if (result.status !== 0 || !fs.existsSync(index)) {
    console.log(`[android-report] merge-reports failed; the ${zips.length} blob(s) are kept at ${mergeDir}.`);
    return;
  }
  // merge-reports reports the longest step as the total; the steps ran one after another.
  spawnSync(process.execPath, [path.join(root, 'scripts', 'patch-report-total-time.js'), index, String(startedAt), String(Date.now() - startedAt)], { stdio: 'ignore' });
  console.log(`[android-report] one HTML report for all ${zips.length} Playwright step(s): ${index}`);
  console.log('[android-report]   open it with: npx playwright show-report playwright-report-android');
}

/** Owner only: print every step of every phase, then merge the blobs. Returns true if all passed. */
export function finishSweepReport() {
  if (!owner) return true;
  const steps = readSteps();
  const failed = steps.filter((step) => !step.ok);
  console.log('\n[android-report] ───────────── every step ─────────────');
  for (const step of steps) {
    const mark = step.ok ? 'pass' : 'FAIL';
    console.log(`  ${mark}  ${formatSeconds(step.seconds).padStart(7)}  [${step.phase}] ${step.label}${step.detail ? ` (${step.detail})` : ''}`);
  }
  console.log(`[android-report] ${steps.length - failed.length} of ${steps.length} step(s) passed; total ${formatSeconds(Math.round((Date.now() - startedAt) / 1000))}`);
  if (failed.length) console.log(`[android-report] failed: ${failed.map((step) => `[${step.phase}] ${step.label}`).join('; ')}`);
  mergeBlobs();
  return failed.length === 0;
}

// A sweep stopped part way never reaches finishSweepReport. Rebuild its report by hand:
//   node scripts/lib/android-sweep-report.mjs <run id under blob-report/>
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runId = process.argv[2] || '';
  const stepsFile = path.join(root, 'blob-report', runId, 'steps.jsonl');
  if (!runId || !fs.existsSync(stepsFile)) {
    console.error('usage: node scripts/lib/android-sweep-report.mjs <run id> (a blob-report/ directory with steps.jsonl)');
    process.exit(2);
  }
  owner = true;
  startedAt = fs.statSync(stepsFile).birthtimeMs || Date.now();
  process.env.E2E_RUN_ID = runId;
  process.env.ANDROID_SWEEP_STEPS_FILE = stepsFile;
  process.exit(finishSweepReport() ? 0 : 1);
}
