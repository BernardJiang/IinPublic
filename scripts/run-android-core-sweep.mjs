import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import { beginSweepReport, finishSweepReport, recordStep } from './lib/android-sweep-report.mjs';
import { runParallel } from './lib/parallel-steps.mjs';
import { useTestAbisFor } from './lib/android-test-abis.mjs';

const args = process.argv.slice(2);
const planOnly = args.includes('--plan');
const hostOnly = args.includes('--host-only');
const install = args.includes('--install');

function valuesAfter(flag) {
  return args.flatMap((arg, index) => arg === flag && args[index + 1] ? [args[index + 1]] : []);
}

/** Run one step and record it; a failed step ends the sweep unless `keepGoing`. */
function run(command, commandArgs, environment = {}, { label = '', keepGoing = false } = {}) {
  process.stdout.write(`\n[android-core] $ ${[command, ...commandArgs].join(' ')}\n`);
  const startedAt = Date.now();
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
  const ok = result.status === 0;
  recordStep('core', label || [command, ...commandArgs].join(' '), ok, startedAt, ok ? '' : `exit ${result.status ?? 'unknown'}`);
  if (!ok && !keepGoing) {
    finishSweepReport();
    process.exit(result.status ?? 1);
  }
  return ok;
}

function connectedSerials() {
  const requested = [
    ...valuesAfter('--serial'),
    ...(process.env.NATIVE_APP_ANDROID_SERIALS || process.env.NATIVE_APP_ANDROID_SERIAL || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ];
  if (requested.length > 0) return [...new Set(requested)];
  const output = execFileSync('adb', ['devices'], { encoding: 'utf8' });
  return output
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([, state]) => state === 'device')
    .map(([serial]) => serial);
}

function lanAddress() {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST explicitly.');
}

const plan = [
  'Classify every Jest/E2E file and fail if the inventory has holes.',
  'Build one deterministic contract bundle for Node 18 and Android WebView (Chrome 101+), and a bundle of the portable unit files (Chrome 61+).',
  'Run both bundles in host Node and headless Chromium, then smoke the mobile embedded-Node bundle.',
  'Run the portable unit files in host Node and headless Chromium and record their test ids.',
  ...(hostOnly ? [] : [
    ...(install ? ['Build and install the current debug APK on each selected phone.'] : []),
    'Run the same contracts and unit files in each selected phone app WebView and embedded Node, all phones at once; each must report the host ids.',
  ]),
];

if (planOnly) {
  process.stdout.write('[android-core] plan (no build, adb query, install, or test is performed)\n');
  plan.forEach((step, index) => process.stdout.write(`  ${index + 1}. ${step}\n`));
  process.exit(0);
}

beginSweepReport('android-core');
run('node', ['scripts/android-test-coverage.mjs']);
run('node', ['scripts/build-portable-core-test-bundle.mjs']);
run('node', ['dist/device-tests/portable-core-node.cjs']);
run('node', ['scripts/run-portable-core-browser.mjs']);
run('node', ['scripts/run-portable-jest-host.mjs'], {}, { label: 'unit files run unchanged in host Node and headless Chromium (portable Jest)' });
run('npm', ['run', 'build:embedded']);
run('npm', ['run', 'build:embedded-mobile']);
run('node', ['scripts/smoke-embedded-node.js'], {
  SMOKE_EMBEDDED_MOBILE: '1',
  SMOKE_PORTABLE_CORE: '1',
});
if (hostOnly) {
  finishSweepReport();
  process.exit(0);
}

const serials = connectedSerials();
if (serials.length === 0) {
  process.stderr.write('[android-core] No authorized Android device is connected. Use --host-only for device-free validation.\n');
  finishSweepReport();
  process.exit(1);
}

if (install) {
  useTestAbisFor(serials);
  run('npm', ['run', 'android:build']);
  run('node', ['scripts/install-android-matrix.mjs'], { NATIVE_APP_ANDROID_SERIALS: serials.join(','), NATIVE_APP_ANDROID_NAMES: '' },
    { label: 'install the current APK (phones that already have it are skipped)' });
}

const host = lanAddress();
// Every phone runs, at the same time on its own hub port, even after one fails, so the report
// shows each phone's result.
const coreStartedAt = Date.now();
const coreResults = await runParallel(serials.map((serial, index) => ({
  tag: serial,
  command: 'npx',
  args: [
    'playwright', 'test',
    '--config', 'tests/e2e/native-app/playwright.config.ts',
    'tests/e2e/native-app/34-android-portable-core-contracts.spec.ts',
  ],
  env: {
    ...process.env,
    E2E_REAL_ANDROID_CORE: '1',
    NATIVE_APP_ANDROID_SERIAL: serial,
    NATIVE_APP_ANDROID_HOST: host,
    NATIVE_APP_E2E_GUN_PORT: String(9078 + 100 * index),
  },
  timeoutMs: 15 * 60_000,
})));
const failedSerials = serials.filter((serial, index) => {
  const result = coreResults[index];
  recordStep('core', `portable core contracts on ${serial}`, result.ok, coreStartedAt,
    result.ok ? '' : (result.error || `exit ${result.status ?? 'unknown'}`));
  return !result.ok;
});

if (failedSerials.length) {
  process.stdout.write(`\n[android-core] FAIL on ${failedSerials.join(', ')} (${serials.length - failedSerials.length} of ${serials.length} phone(s) passed).\n`);
} else {
  process.stdout.write(`\n[android-core] PASS: host parity plus ${serials.length} Android device(s).\n`);
}
finishSweepReport();
process.exit(failedSerials.length ? 1 : 0);
