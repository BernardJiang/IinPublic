#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, 'tests', 'matrix', 'devices.json');
const configured = JSON.parse(fs.readFileSync(configPath, 'utf8')).android || [];
const scenario = process.argv[2] || 'x3';
if (!['x3', 'custody'].includes(scenario)) {
  console.error(`Usage: node scripts/run-x3-android-e2e.mjs [x3|custody]`);
  process.exit(2);
}

function fail(message) {
  console.error(`[android-physical] ${message}`);
  process.exit(1);
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let adbOutput = '';
try {
  adbOutput = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 5_000 });
} catch (error) {
  fail(`ADB availability check failed before build/test: ${error instanceof Error ? error.message : String(error)}`);
}

const readySerials = new Set(
  adbOutput.split(/\r?\n/).slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((row) => row[1] === 'device')
    .map((row) => row[0]),
);
const requestedSerial = String(process.env.NATIVE_APP_ANDROID_SERIAL || '').trim();
const selected = requestedSerial
  ? configured.find((device) => device.serial === requestedSerial) || { name: 'android-selected', serial: requestedSerial }
  : configured.find((device) => readySerials.has(device.serial));

if (!selected) {
  fail(`No configured Android phone is connected and authorized; checked ${configured.map((device) => `${device.name} (${device.serial})`).join(', ')}`);
}
if (!readySerials.has(selected.serial)) {
  fail(`Selected Android phone ${selected.name} (${selected.serial}) is not connected and authorized; no build or test was started`);
}

console.log(`[android-physical] ${scenario} preflight passed: ${selected.name} (${selected.serial})`);
run('npm', ['run', 'android:build']);

const childEnv = {
  ...process.env,
  NATIVE_APP_ANDROID_SERIAL: selected.serial,
  NATIVE_APP_ANDROID_SERIALS: selected.serial,
  // This older Huawei transfers the ~200 MiB debug APK at roughly 1.5 MiB/s. Keep a hard
  // bound, but leave enough room for a healthy slow transfer plus package verification.
  ANDROID_INSTALL_TIMEOUT_MS: process.env.ANDROID_INSTALL_TIMEOUT_MS || '240000',
};
run(process.execPath, [path.join(repoRoot, 'scripts', 'install-android-matrix.mjs')], childEnv);

const playwrightArgs = scenario === 'custody'
  ? [
      'test',
      '--config', 'tests/e2e/native-app/playwright.config.ts',
      'tests/e2e/native-app/18-android-keystore-custody.spec.ts',
      '--workers=1',
      '--reporter=list',
    ]
  : [
      'test',
      'tests/e2e/cross-platform/x3-identity-linking.spec.ts',
      '--project=chromium',
      '--workers=1',
    ];
run(path.join(repoRoot, 'node_modules', '.bin', 'playwright'), playwrightArgs, {
  ...childEnv,
  ...(scenario === 'x3' ? { E2E_REAL_ANDROID_X3_LINKING: '1' } : {}),
  E2E_GUN_MEMORY_ONLY: '1',
  E2E_STATIC_WEB: '1',
  DISABLE_HMR: 'true',
  PW_WORKERS: '1',
  E2E_PORT_OFFSET: process.env.E2E_PORT_OFFSET || '700',
});
