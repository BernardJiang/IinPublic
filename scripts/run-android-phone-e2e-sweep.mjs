#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'tests', 'matrix', 'devices.json');
const apkPath = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const playwright = path.join(root, 'node_modules', '.bin', 'playwright');
const nativeConfig = 'tests/e2e/native-app/playwright.config.ts';
const planOnly = process.argv.includes('--plan');
const configured = JSON.parse(fs.readFileSync(configPath, 'utf8')).android || [];
const failures = [];
const omissions = [];
let latestBuildReady = false;

function fail(message) {
  console.error(`[android-sweep] ${message}`);
  process.exit(1);
}

function readyAdbSerials() {
  let output = '';
  try {
    output = execFileSync('adb', ['devices'], { encoding: 'utf8', timeout: 10_000 });
  } catch (error) {
    fail(`ADB preflight failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return new Set(
    output.split(/\r?\n/).slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter((row) => row[1] === 'device')
      .map((row) => row[0]),
  );
}

function selectedDevices() {
  const ready = readyAdbSerials();
  const explicit = String(process.env.NATIVE_APP_ANDROID_SERIALS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const bySerial = new Map(configured.map((device) => [device.serial, device]));
  const selected = explicit.length
    ? explicit.map((serial, index) => bySerial.get(serial) || { name: `android-${index + 1}`, serial })
    : configured.filter((device) => ready.has(device.serial));
  if (selected.length < 2) {
    fail(`At least two connected phones are required; selected ${selected.length}. `
      + 'Set NATIVE_APP_ANDROID_SERIALS to reserve the phones for this destructive sweep.');
  }
  const unavailable = selected.filter((device) => !ready.has(device.serial));
  if (unavailable.length) {
    fail(`Selected phones are unavailable: ${unavailable.map((device) => `${device.name} (${device.serial})`).join(', ')}`);
  }
  return selected;
}

function commandLine(command, args) {
  return [command, ...args].join(' ');
}

function runStep(label, command, args, env = process.env, timeoutMs = 2 * 60 * 60_000) {
  console.log(`\n[android-sweep] === ${label} ===`);
  console.log(`[android-sweep] ${commandLine(command, args)}`);
  if (planOnly) return true;
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: timeoutMs,
  });
  if (result.error) {
    console.error(`[android-sweep] ${label} failed to start: ${result.error.message}`);
    failures.push(label);
    return false;
  }
  if (result.status !== 0) {
    console.error(`[android-sweep] ${label} failed with exit code ${result.status ?? 'unknown'}`);
    failures.push(label);
    return false;
  }
  return true;
}

function runNative(label, specs, env) {
  return runStep(label, playwright, [
    'test', '--config', nativeConfig, ...specs, '--workers=1', '--reporter=list',
  ], env);
}

function bestEffortLatestInstall(devices, label) {
  console.log(`\n[android-sweep] === ${label} ===`);
  if (planOnly) {
    console.log(`[android-sweep] npm run android:build`);
    console.log(`[android-sweep] node scripts/install-android-matrix.mjs (${devices.map((d) => d.serial).join(',')})`);
    return;
  }
  if (!latestBuildReady || !fs.existsSync(apkPath)) {
    const built = runStep(`${label}: build latest APK`, 'npm', ['run', 'android:build']);
    latestBuildReady = built && fs.existsSync(apkPath);
  }
  if (!latestBuildReady) {
    failures.push(`${label}: latest APK unavailable`);
    return;
  }
  const installEnv = {
    ...process.env,
    NATIVE_APP_ANDROID_SERIALS: devices.map((device) => device.serial).join(','),
    NATIVE_APP_ANDROID_NAMES: '',
    ANDROID_INSTALL_TIMEOUT_MS: process.env.ANDROID_INSTALL_TIMEOUT_MS || '300000',
  };
  runStep(`${label}: install latest APK`, process.execPath, [
    path.join(root, 'scripts', 'install-android-matrix.mjs'),
  ], installEnv, Math.max(10 * 60_000, devices.length * 6 * 60_000));
}

const devices = selectedDevices();
const serials = devices.map((device) => device.serial);
const first = serials[0];
const firstTwo = serials.slice(0, 2);
const firstThree = serials.slice(0, 3);
const firstFour = serials.slice(0, 4);
const commonEnv = {
  ...process.env,
  NATIVE_APP_ANDROID_SERIAL: first,
  NATIVE_APP_ANDROID_SERIALS: serials.join(','),
  NATIVE_APP_ANDROID_NAMES: '',
  PW_WORKERS: '1',
  DISABLE_HMR: 'true',
};

console.log(`[android-sweep] selected ${devices.length} phone(s): ${devices.map((d) => `${d.name} (${d.serial})`).join(', ')}`);
console.log('[android-sweep] WARNING: this sweep clears IinPublic app data and changes Wi-Fi/sleep state on test phones.');

try {
  // Deliberately first: it installs release-1 and release-2 fixtures on two phones. Its own
  // runner restores release 2, and the unconditional latest build/install immediately below
  // is the second safety boundary before any ordinary current-version gate runs.
  runStep('mixed release: R1 trusts and upgrades through signed M2 from R2', 'npm', [
    'run', 'test:e2e:android-protocol-manifest',
  ], { ...process.env, NATIVE_APP_ANDROID_SERIALS: firstTwo.join(','), NATIVE_APP_ANDROID_NAMES: '' });

  latestBuildReady = runStep('build latest current-version APK', 'npm', ['run', 'android:build'])
    && (planOnly || fs.existsSync(apkPath));
  if (!latestBuildReady && !planOnly) {
    omissions.push('all current-version gates (latest APK build failed)');
  } else {
    const latestInstalled = runStep('install latest APK on every selected phone', process.execPath, [
      path.join(root, 'scripts', 'install-android-matrix.mjs'),
    ], commonEnv, Math.max(10 * 60_000, devices.length * 6 * 60_000));
    if (!latestInstalled) {
      omissions.push('all current-version gates (latest APK was not installed on every selected phone)');
    } else {
      runNative('one-phone app, Talk, lifecycle, custody, camera, and device-sync gates', [
        'tests/e2e/native-app/05-android-device-boots.spec.ts',
        'tests/e2e/native-app/07-android-authoritative-talk-commit.spec.ts',
        'tests/e2e/native-app/10-android-macmini-device-sync-conversation-merge.spec.ts',
        'tests/e2e/native-app/11-android-cross-engine-directional-pairs.spec.ts',
        'tests/e2e/native-app/12-android-lifecycle-and-network-resilience.spec.ts',
        'tests/e2e/native-app/18-android-keystore-custody.spec.ts',
        'tests/e2e/native-app/26-android-camera-and-file-permissions.spec.ts',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIALS: first,
        E2E_REAL_ANDROID_TALK_COMMIT: '1',
        E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC: '1',
        E2E_REAL_ANDROID_DIRECTIONAL_PAIRS: '1',
        E2E_REAL_ANDROID_LIFECYCLE: '1',
        E2E_REAL_ANDROID_CAMERA: '1',
      });

      runStep('website-to-phone identity-link gates (X3)', playwright, [
        'test', 'tests/e2e/cross-platform/x3-identity-linking.spec.ts',
        '--project=chromium', '--workers=1', '--reporter=list',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIALS: first,
        E2E_REAL_ANDROID_X3_LINKING: '1',
        E2E_GUN_MEMORY_ONLY: '1',
        E2E_STATIC_WEB: '1',
        E2E_PORT_OFFSET: process.env.E2E_PORT_OFFSET || '700',
      });

      runNative('current-version browser, desktop, and phone matrix', [
        'tests/e2e/native-app/06-seven-client-real-device-matrix.spec.ts',
      ], { ...commonEnv, E2E_REAL_DEVICE_MATRIX: '1' });

      runNative('sleeping receiver notification and wake delivery', [
        'tests/e2e/native-app/28-android-sleeping-receiver-notification.spec.ts',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIALS: firstTwo.join(','),
        NATIVE_APP_ANDROID_SENDER: firstTwo[0],
        NATIVE_APP_ANDROID_SLEEPER: firstTwo[1],
        E2E_REAL_ANDROID_SLEEP_NOTIFY: '1',
      });

      if (devices.length >= 3) {
        const threePhoneEnv = { ...commonEnv, NATIVE_APP_ANDROID_SERIALS: firstThree.join(',') };
        runNative('three-phone offline and resynchronization', [
          'tests/e2e/native-app/13-android-three-phone-offline-resync.spec.ts',
        ], { ...threePhoneEnv, E2E_REAL_ANDROID_THREE_PHONE_RESYNC: '1' });
        runNative('three-phone offline Wi-Fi Direct nearby exchange', [
          'tests/e2e/native-app/30-android-four-phone-nearby.spec.ts',
        ], {
          ...threePhoneEnv,
          E2E_REAL_ANDROID_FOUR_PHONE_NEARBY: '1',
          E2E_NEARBY_OFFLINE_WIFI_DIRECT: '1',
        });
        runNative('three-phone nearby cohort traversal', [
          'tests/e2e/native-app/31-android-three-phone-cohort-traversal.spec.ts',
        ], { ...threePhoneEnv, E2E_REAL_ANDROID_THREE_PHONE_COHORTS: '1' });
      } else {
        omissions.push('three-phone resync, Wi-Fi Direct, and cohort gates (need 3 phones)');
      }

      if (devices.length >= 4) {
        runNative('four-phone online nearby convergence', [
          'tests/e2e/native-app/30-android-four-phone-nearby.spec.ts',
        ], {
          ...commonEnv,
          NATIVE_APP_ANDROID_SERIALS: firstFour.join(','),
          E2E_REAL_ANDROID_FOUR_PHONE_NEARBY: '1',
          E2E_NEARBY_OFFLINE_WIFI_DIRECT: '0',
        });
      } else {
        omissions.push('four-phone online nearby gate (need 4 phones)');
      }
    }
  }
} finally {
  // Always finish on an ordinary current build. This runs even after test/build failures and
  // covers every selected phone, not just the two used by the mixed-release gate.
  bestEffortLatestInstall(devices, 'final latest-version restore');
}

console.log('\n[android-sweep] === summary ===');
console.log(`[android-sweep] failures: ${failures.length ? failures.join('; ') : 'none'}`);
console.log(`[android-sweep] not scheduled: ${omissions.length ? omissions.join('; ') : 'none'}`);
if (planOnly) console.log('[android-sweep] plan only; no builds, installs, app-data clears, or tests were performed.');
process.exit(failures.length ? 1 : 0);
