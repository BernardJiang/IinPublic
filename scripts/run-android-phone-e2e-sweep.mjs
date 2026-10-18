#!/usr/bin/env node

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { beginSweepReport, finishSweepReport, listReporterArgs, recordStep } from './lib/android-sweep-report.mjs';
import { runParallel } from './lib/parallel-steps.mjs';
import { useTestAbisFor } from './lib/android-test-abis.mjs';

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

// Same as test:all: .env.local supplies the TechSupport keys the 08/09/27 gates need. Values
// already in the environment win.
const envLocal = path.join(root, '.env.local');
if (fs.existsSync(envLocal)) {
  for (const line of fs.readFileSync(envLocal, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

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
  const explicit = String(process.env.NATIVE_APP_ANDROID_SERIALS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const bySerial = new Map(configured.map((device) => [device.serial, device]));
  if (planOnly) {
    const planned = explicit.length
      ? explicit.map((serial, index) => bySerial.get(serial) || { name: `android-${index + 1}`, serial })
      : configured;
    if (planned.length < 2) {
      fail(`At least two configured phones are required to construct the sweep plan; found ${planned.length}.`);
    }
    return planned;
  }
  const ready = readyAdbSerials();
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
  const stepStartedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    timeout: timeoutMs,
  });
  if (result.error) {
    console.error(`[android-sweep] ${label} failed to start: ${result.error.message}`);
    failures.push(label);
    recordStep('phones', label, false, stepStartedAt, 'did not start');
    return false;
  }
  if (result.status !== 0) {
    console.error(`[android-sweep] ${label} failed with exit code ${result.status ?? 'unknown'}`);
    failures.push(label);
    recordStep('phones', label, false, stepStartedAt, `exit ${result.status ?? 'unknown'}`);
    return false;
  }
  recordStep('phones', label, true, stepStartedAt);
  return true;
}

/** Selected phones with a ready SIM, in sweep order (NATIVE_APP_ANDROID_CELLULAR goes first). */
function simPhones(devices) {
  const explicit = process.env.NATIVE_APP_ANDROID_CELLULAR?.trim();
  const found = [];
  for (const device of devices) {
    if (planOnly) {
      if (device.sim) found.push(device.serial);
      continue;
    }
    try {
      const state = execFileSync('adb', ['-s', device.serial, 'shell', 'getprop', 'gsm.sim.state'], { encoding: 'utf8', timeout: 10_000 });
      if (/READY|LOADED/.test(state)) found.push(device.serial);
    } catch {
      // not reachable: not a candidate
    }
  }
  return explicit ? [explicit, ...found.filter((serial) => serial !== explicit)] : found;
}

function nativeStep(label, specs, env) {
  // Own output folder: Playwright empties its output folder when it starts, which would delete a
  // lane running beside it's screenshots and traces.
  const output = path.join('test-results', 'android-sweep', label.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 80));
  return { label, command: playwright, args: ['test', '--config', nativeConfig, ...specs, '--workers=1', '--output', output, ...listReporterArgs()], env };
}

/** Run steps at once (one step runs as before, unprefixed). Each is recorded like runStep. */
async function runSteps(steps) {
  if (steps.length === 1) {
    const [step] = steps;
    return [runStep(step.label, step.command, step.args, step.env)];
  }
  for (const step of steps) {
    console.log(`\n[android-sweep] === ${step.label} (in parallel) ===`);
    console.log(`[android-sweep] ${commandLine(step.command, step.args)}`);
  }
  if (planOnly) return steps.map(() => true);
  const startedAt = Date.now();
  const results = await runParallel(steps.map((step, index) => ({
    tag: `lane ${String.fromCharCode(65 + index)}`,
    command: step.command,
    args: step.args,
    env: step.env,
    cwd: root,
    timeoutMs: 2 * 60 * 60_000,
  })));
  return results.map((result, index) => {
    const { label } = steps[index];
    if (!result.ok) {
      console.error(`[android-sweep] ${label} failed (${result.error || `exit ${result.status ?? 'unknown'}`})`);
      failures.push(label);
    }
    recordStep('phones', label, result.ok, startedAt, result.ok ? 'parallel' : (result.error || `exit ${result.status ?? 'unknown'}`));
    return result.ok;
  });
}

function runNative(label, specs, env) {
  return runStep(label, playwright, [
    'test', '--config', nativeConfig, ...specs, '--workers=1', ...listReporterArgs(),
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
if (!planOnly) {
  beginSweepReport('android-phones');
  useTestAbisFor(devices.map((device) => device.serial));
}
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
      // Native specs 06/10/11 launch the packaged macOS app. Build it from the same current web
      // tree as the just-installed APK; otherwise a months-old app bundle can make a phone gate
      // look like a protocol regression. The launcher also verifies build-id + content checksums.
      const desktopBuildReady = runStep('build current macOS test bundle', 'npm', [
        'run', 'desktop:dist:dir',
      ]);
      if (!desktopBuildReady) {
        omissions.push('desktop/phone gates 06/10/11 (current macOS test bundle build failed)');
      }

      // The one-phone gates and X3 each need a single phone, so they run at once on different
      // phones with their own hub ports (about 7 min instead of 13 in a row). Lane ports count DOWN
      // from 9078: a hub at H serves its page on H - 8080 + 3001, and the web app maps only pages on
      // 3001-4000 to their hub — at 9178 (page 4099) browser peers looked for Gun on the static
      // server and spec 12's match never formed (1.0.159 sweep). X3 uses offset 700 (8780/3701). Lane A keeps the
      // gates that also launch the macOS app or host browsers; only one lane may do that.
      // Lane B takes the third phone when there is one (the PH-1, Android 10 like the first): its
      // Wi-Fi toggling and camera gates have only been qualified on Android 10 phones, while X3
      // (website linking) runs on any phone.
      const oneLaneB = serials[2] || serials[1];
      const x3Serial = serials[2] ? serials[1] : '';
      const oneEnv = (serial, gunPort) => ({
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIAL: serial,
        NATIVE_APP_ANDROID_SERIALS: serial,
        NATIVE_APP_E2E_GUN_PORT: String(gunPort),
        E2E_REAL_ANDROID_TALK_COMMIT: '1',
        E2E_REAL_ANDROID_DESKTOP_DEVICE_SYNC: '1',
        E2E_REAL_ANDROID_DIRECTIONAL_PAIRS: '1',
        E2E_REAL_ANDROID_LIFECYCLE: '1',
        E2E_REAL_ANDROID_CAMERA: '1',
        E2E_REAL_ANDROID_LOCATION: '1',
      });
      const x3Step = (serial) => ({
        label: `website-to-phone identity-link gates (X3) on ${serial}`,
        command: playwright,
        args: ['test', 'tests/e2e/cross-platform/x3-identity-linking.spec.ts', '--project=chromium', '--workers=1', ...listReporterArgs()],
        env: {
          ...commonEnv,
          NATIVE_APP_ANDROID_SERIAL: serial,
          NATIVE_APP_ANDROID_SERIALS: serial,
          E2E_REAL_ANDROID_X3_LINKING: '1',
          E2E_GUN_MEMORY_ONLY: '1',
          E2E_STATIC_WEB: '1',
          E2E_PORT_OFFSET: process.env.E2E_PORT_OFFSET || '700',
        },
      });
      await runSteps([
        nativeStep(`one-phone app, Talk, and desktop/browser gates on ${first}`, [
          'tests/e2e/native-app/05-android-device-boots.spec.ts',
          'tests/e2e/native-app/07-android-authoritative-talk-commit.spec.ts',
          ...(desktopBuildReady ? [
            'tests/e2e/native-app/10-android-macmini-device-sync-conversation-merge.spec.ts',
            'tests/e2e/native-app/11-android-cross-engine-directional-pairs.spec.ts',
          ] : []),
        ], oneEnv(first, 9078)),
        nativeStep(`one-phone lifecycle, custody, camera, and location gates on ${oneLaneB}`, [
          'tests/e2e/native-app/12-android-lifecycle-and-network-resilience.spec.ts',
          'tests/e2e/native-app/18-android-keystore-custody.spec.ts',
          'tests/e2e/native-app/26-android-camera-and-file-permissions.spec.ts',
          'tests/e2e/native-app/35-android-location-reask.spec.ts',
        ], oneEnv(oneLaneB, 8978)),
        ...(x3Serial ? [x3Step(x3Serial)] : []),
      ]);
      if (!x3Serial) await runSteps([x3Step(first)]);

      if (desktopBuildReady) {
        runNative('current-version browser, desktop, and phone matrix', [
          'tests/e2e/native-app/06-seven-client-real-device-matrix.spec.ts',
        ], { ...commonEnv, E2E_REAL_DEVICE_MATRIX: '1' });
      }

      // 28 and 33 run on the first two phones (28's sleeper must be the Android 12+ second one);
      // with four phones, 09 runs at the same time on the other two with its own hub port (8878). 09 is
      // the only one of the three that launches the macOS app.
      const twoPhoneSteps = [nativeStep('sleeping receiver notification, then two-phone Place create, find, enter, leave, re-enter', [
        'tests/e2e/native-app/28-android-sleeping-receiver-notification.spec.ts',
        'tests/e2e/native-app/33-android-place-smoke.spec.ts',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIALS: firstTwo.join(','),
        NATIVE_APP_ANDROID_SENDER: firstTwo[0],
        NATIVE_APP_ANDROID_SLEEPER: firstTwo[1],
        E2E_REAL_ANDROID_SLEEP_NOTIFY: '1',
        E2E_REAL_ANDROID_PLACE_SMOKE: '1',
      })];

      // TechSupport gates sign as the real TechSupport identity; without its keys in .env.local
      // they would only skip, so say so in the summary instead of running them.
      if (process.env.TECHSUPPORT_SEA_PAIR_JSON?.trim()) {
        // 08's desktop operator signs in with the root TechSupport key, which production web
        // bundles have refused since 2026-09-21 (OPEN-27: use a delegated operator). 09 answers a
        // phone asker through a delegate, the production route, so it stands in for 08.
        omissions.push('TechSupport root-operator gate 08 (root browser mode is disabled in production bundles; 09 covers phone askers through a delegate)');
        const pair = devices.length >= 4 ? serials.slice(2, 4) : firstTwo;
        const delegateStep = nativeStep(`TechSupport delegate on ${pair[0]} answers an asker on ${pair[1]}`, [
          'tests/e2e/native-app/09-android-techsupport-delegate-answers.spec.ts',
        ], {
          ...commonEnv,
          NATIVE_APP_ANDROID_SERIALS: pair.join(','),
          // Not 9178: 33, running beside it, starts its own release-capacity hub there (1.0.159
          // sweep: 33's hub could not bind, and it ran against 09's). Below 9078, see the lanes.
          NATIVE_APP_E2E_GUN_PORT: devices.length >= 4 ? '8878' : '9078',
          E2E_REAL_ANDROID_TECHSUPPORT_DELEGATE: '1',
          NATIVE_APP_ANDROID_SERIAL_DELEGATE: pair[0],
          NATIVE_APP_ANDROID_SERIAL_ASKER: pair[1],
        });
        if (devices.length >= 4) twoPhoneSteps.push(delegateStep);
        else {
          await runSteps(twoPhoneSteps);
          twoPhoneSteps.splice(0, 1, delegateStep);
        }
      } else {
        omissions.push('TechSupport answer and delegate gates 08/09 (TECHSUPPORT_SEA_PAIR_JSON not set in .env.local)');
      }
      await runSteps(twoPhoneSteps);
      if (process.env.TECHSUPPORT_RECOVERY_KEY_FILE?.trim() || process.env.TECHSUPPORT_RECOVERY_SEA_PAIR_JSON?.trim()) {
        runNative('TechSupport recovery anchor catch-up', [
          'tests/e2e/native-app/27-android-techsupport-recovery-anchor-catch-up.spec.ts',
        ], commonEnv);
      } else {
        omissions.push('TechSupport recovery-anchor gate 27 (no TECHSUPPORT_RECOVERY_KEY_FILE / _SEA_PAIR_JSON)');
      }

      // Real cellular: needs a phone with a SIM; it runs against the public hub in a private room.
      // With two SIM phones it runs again with both on mobile data (both behind carrier NAT).
      const sims = simPhones(devices);
      const cellular = sims[0];
      const wifiPeer = serials.find((serial) => serial !== cellular && !sims.includes(serial))
        || serials.find((serial) => serial !== cellular);
      const cellularEnv = (peer, extra = {}) => ({
        ...commonEnv,
        E2E_REAL_ANDROID_CELLULAR: '1',
        NATIVE_APP_ANDROID_CELLULAR: cellular,
        NATIVE_APP_ANDROID_WIFI_PEER: peer,
        ...extra,
      });
      // The shared two-person journeys (tests/e2e/journeys/, also run by phone-path/02 and /04).
      // With five phones they run on the two the cellular gate leaves idle, at the same time.
      const busyForCellular = new Set([cellular, wifiPeer, sims[1]].filter(Boolean));
      const idle = serials.filter((serial) => !busyForCellular.has(serial));
      const journeyPair = idle.length >= 2 ? idle.slice(0, 2) : firstTwo;
      const journeyStep = nativeStep(`two-person journeys on ${journeyPair.join(' and ')}: match and chat, mismatch, block, leave`, [
        'tests/e2e/native-app/37-android-talk-match-chat-journey.spec.ts',
        'tests/e2e/native-app/38-android-mismatch-block-leave.spec.ts',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIALS: journeyPair.join(','),
        E2E_REAL_ANDROID_JOURNEYS: '1',
        // Not 9078: 29 starts the config hub there when it runs beside this lane.
        NATIVE_APP_E2E_GUN_PORT: '8978',
      });
      const cellularStep = cellular && wifiPeer
        ? nativeStep('cellular phone and Wi-Fi phone exchange Talks and a DM', [
          'tests/e2e/native-app/29-android-cellular-talk-exchange.spec.ts',
        ], cellularEnv(wifiPeer))
        : null;
      if (!cellularStep) omissions.push('cellular gate 29 (no selected phone has a ready SIM)');
      if (cellularStep && idle.length >= 2) {
        await runSteps([cellularStep, journeyStep]);
      } else {
        if (cellularStep) await runSteps([cellularStep]);
        await runSteps([journeyStep]);
      }
      if (sims.length >= 2) {
        runNative(`two phones on mobile data (${sims[0]}, ${sims[1]}) exchange Talks and a DM`, [
          'tests/e2e/native-app/29-android-cellular-talk-exchange.spec.ts',
        ], cellularEnv(sims[1], { E2E_CELLULAR_PEER_TOO: '1' }));
      } else if (cellular) {
        omissions.push('cellular gate 29 with both phones on mobile data (needs two phones with a ready SIM)');
      }

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

      // Last, because it leaves each phone's permissions as a person would after first launch
      // (everything but the camera allowed): every phone at once, each with its own hub port
      // (9078 down, as in the one-phone lanes).
      await runSteps(serials.map((serial, index) => nativeStep(`runtime permissions asked once at first launch on ${serial}`, [
        'tests/e2e/native-app/36-android-permission-batch.spec.ts',
      ], {
        ...commonEnv,
        NATIVE_APP_ANDROID_SERIAL: serial,
        NATIVE_APP_ANDROID_SERIALS: serial,
        NATIVE_APP_E2E_GUN_PORT: String(9078 - 100 * index),
        E2E_REAL_ANDROID_PERMISSIONS: '1',
      })));
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
else finishSweepReport();
process.exit(failures.length ? 1 : 0);
