#!/usr/bin/env node
// Short pre-release smoke run (docs/testing/journey-coverage.md, "Release smoke"): about 15–25
// minutes, versus hours for the full sweep (scripts/run-android-phone-e2e-sweep.mjs). Run it on
// the build you are about to upload, before uploading.
//
//   1. phone-path journeys — no phones; the app's phone route (embedded node + hub relay, no
//      WebCrypto) for the Place and Talk journeys;
//   2. one phone: the app boots on a fresh install and a Talk commits;
//   3. two phones: create a Place, find it, enter it, leave it, re-enter it.
//
// DESTRUCTIVE on the phones it uses: clears IinPublic app data. The phones are shared, so name
// them explicitly:
//   NATIVE_APP_ANDROID_SERIALS=<serial1>,<serial2> npm run test:android:release-smoke
// Flags: --plan (print the steps only), --install (build and install the debug APK first),
//        --skip-phone-path (phones only).
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwright = path.join(root, 'node_modules', '.bin', 'playwright');
const nativeConfig = 'tests/e2e/native-app/playwright.config.ts';
const args = new Set(process.argv.slice(2));
const planOnly = args.has('--plan');
const failures = [];

function readySerials() {
  const output = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 10_000 });
  return new Set(output.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/))
    .filter((row) => row[1] === 'device').map((row) => row[0]));
}

const serials = String(process.env.NATIVE_APP_ANDROID_SERIALS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (serials.length < 2) {
  console.error('[release-smoke] Name two phones: NATIVE_APP_ANDROID_SERIALS=<serial1>,<serial2> (their app data is cleared).');
  process.exit(1);
}
if (!planOnly) {
  const ready = readySerials();
  const missing = serials.filter((serial) => !ready.has(serial));
  if (missing.length) {
    console.error(`[release-smoke] Not connected over adb: ${missing.join(', ')}`);
    process.exit(1);
  }
}

function step(label, command, commandArgs, env = {}) {
  console.log(`\n[release-smoke] === ${label} ===`);
  console.log(`[release-smoke] ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')} ${command} ${commandArgs.join(' ')}`.trim());
  if (planOnly) return true;
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } });
  const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
  const ok = !result.error && result.status === 0;
  console.log(`[release-smoke] ${ok ? 'PASS' : 'FAIL'} ${label} (${minutes} min)`);
  if (!ok) failures.push(label);
  return ok;
}

const phoneEnv = { NATIVE_APP_ANDROID_NAMES: '', PW_WORKERS: '1' };

step('build web + server (dist/)', 'npm', ['run', '-s', 'build:embedded']);
if (args.has('--install')) {
  step('build debug APK', 'npm', ['run', 'android:build']);
  step('install debug APK on both phones', process.execPath, [path.join(root, 'scripts', 'install-android-matrix.mjs')], {
    ...phoneEnv, NATIVE_APP_ANDROID_SERIALS: serials.slice(0, 2).join(','),
  });
}
if (!args.has('--skip-phone-path')) {
  step('phone-path journeys (no phones)', playwright, ['test', '--config', 'tests/e2e/phone-path/playwright.config.ts']);
}
step('one phone: fresh install boots; a Talk commits', playwright, [
  'test', '--config', nativeConfig,
  'tests/e2e/native-app/05-android-device-boots.spec.ts',
  'tests/e2e/native-app/07-android-authoritative-talk-commit.spec.ts',
  '--workers=1', '--reporter=list',
], { ...phoneEnv, NATIVE_APP_ANDROID_SERIAL: serials[0], NATIVE_APP_ANDROID_SERIALS: serials[0], E2E_REAL_ANDROID_TALK_COMMIT: '1' });
step('two phones: create, find, enter, leave and re-enter a Place', playwright, [
  'test', '--config', nativeConfig, 'tests/e2e/native-app/33-android-place-smoke.spec.ts', '--workers=1', '--reporter=list',
], { ...phoneEnv, NATIVE_APP_ANDROID_SERIALS: serials.slice(0, 2).join(','), E2E_REAL_ANDROID_PLACE_SMOKE: '1' });

if (planOnly) process.exit(0);
console.log(failures.length
  ? `\n[release-smoke] FAILED: ${failures.join('; ')} — do not upload this build.`
  : '\n[release-smoke] All smoke checks passed.');
process.exit(failures.length ? 1 : 0);
