#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { listReporterArgs } from './lib/android-sweep-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-protocol-manifest-'));
const artifactDir = path.join(tempRoot, 'artifacts');
const currentApk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const release1Artifact = path.join(artifactDir, 'iinpublic-release1.apk');
const release2Artifact = path.join(artifactDir, 'iinpublic-release2.apk');
const spec = 'tests/e2e/native-app/32-android-protocol-manifest-upgrade.spec.ts';
let exitCode = 1;

function run(command, args, cwd = root, env = process.env) {
  console.log(`\n[protocol-manifest-e2e] ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, env, stdio: 'inherit', timeout: 30 * 60_000 });
}

function selectedSerials() {
  const explicit = String(process.env.NATIVE_APP_ANDROID_SERIALS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  if (explicit.length) return explicit.slice(0, 2);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'matrix', 'devices.json'), 'utf8'));
  return (config.android || []).map((device) => device.serial).slice(0, 2);
}

try {
  const serials = selectedSerials();
  if (serials.length !== 2) throw new Error('Exactly two Android phone serials are required.');
  fs.mkdirSync(artifactDir);

  run('npm', ['run', 'android:build']);
  fs.copyFileSync(currentApk, release2Artifact);

  run('npm', ['run', 'android:build'], root, {
    ...process.env,
    IINPUBLIC_E2E_PROTOCOL_RELEASE1: '1',
  });
  fs.copyFileSync(currentApk, release1Artifact);
  // Do not leave the workspace's dist/, staged Android assets, or default app-debug.apk carrying
  // the release-1 fixture after the runner exits. Re-stage the ordinary current build before the
  // Playwright server starts; the two immutable test APK copies remain in artifactDir.
  run('npm', ['run', 'android:build']);

  const result = spawnSync('npx', [
    'playwright', 'test',
    '--config', 'tests/e2e/native-app/playwright.config.ts',
    spec,
    '--workers=1',
    ...listReporterArgs(),
  ], {
    cwd: root,
    env: {
      ...process.env,
      E2E_REAL_ANDROID_PROTOCOL_MANIFEST: '1',
      E2E_PROTOCOL_RELEASE1_APK: release1Artifact,
      E2E_PROTOCOL_RELEASE2_APK: release2Artifact,
      NATIVE_APP_ANDROID_SERIALS: serials.join(','),
    },
    stdio: 'inherit',
    timeout: 20 * 60_000,
  });
  exitCode = result.status ?? 1;

  if (process.env.E2E_PROTOCOL_KEEP_MIXED_APKS !== '1') {
    // Restore with the workspace's current app-debug.apk (rebuilt above from the same tree as
    // release 2) so the sweep's next install finds the same MD5 and skips these phones.
    for (const serial of serials) {
      console.log(`[protocol-manifest-e2e] restoring current APK on ${serial}`);
      spawnSync('adb', ['-s', serial, 'install', '--no-streaming', '-r', currentApk], {
        cwd: root, stdio: 'inherit', timeout: 300_000,
      });
    }
  }
} catch (error) {
  console.error(`[protocol-manifest-e2e] ${error instanceof Error ? error.stack : String(error)}`);
  exitCode = 1;
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

process.exit(exitCode);
