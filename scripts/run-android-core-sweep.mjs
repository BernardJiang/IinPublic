import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';

const args = process.argv.slice(2);
const planOnly = args.includes('--plan');
const hostOnly = args.includes('--host-only');
const install = args.includes('--install');

function valuesAfter(flag) {
  return args.flatMap((arg, index) => arg === flag && args[index + 1] ? [args[index + 1]] : []);
}

function run(command, commandArgs, environment = {}) {
  process.stdout.write(`\n[android-core] $ ${[command, ...commandArgs].join(' ')}\n`);
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: { ...process.env, ...environment },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
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
  'Build one deterministic contract bundle for Node 18 and Android WebView (Chrome 101+).',
  'Run both bundles in host Node and headless Chromium, then smoke the mobile embedded-Node bundle.',
  ...(hostOnly ? [] : [
    ...(install ? ['Build and install the current debug APK on each selected phone.'] : []),
    'Run the same contracts in each selected phone app WebView and embedded Node; save one per-device report.',
  ]),
];

if (planOnly) {
  process.stdout.write('[android-core] plan (no build, adb query, install, or test is performed)\n');
  plan.forEach((step, index) => process.stdout.write(`  ${index + 1}. ${step}\n`));
  process.exit(0);
}

run('node', ['scripts/android-test-coverage.mjs']);
run('node', ['scripts/build-portable-core-test-bundle.mjs']);
run('node', ['dist/device-tests/portable-core-node.cjs']);
run('node', ['scripts/run-portable-core-browser.mjs']);
run('npm', ['run', 'build:embedded']);
run('npm', ['run', 'build:embedded-mobile']);
run('node', ['scripts/smoke-embedded-node.js'], {
  SMOKE_EMBEDDED_MOBILE: '1',
  SMOKE_PORTABLE_CORE: '1',
});
if (hostOnly) process.exit(0);

const serials = connectedSerials();
if (serials.length === 0) {
  process.stderr.write('[android-core] No authorized Android device is connected. Use --host-only for device-free validation.\n');
  process.exit(1);
}

if (install) {
  run('npm', ['run', 'android:build']);
  for (const serial of serials) {
    run('adb', ['-s', serial, 'install', '-r', 'android/app/build/outputs/apk/debug/app-debug.apk']);
  }
}

const host = lanAddress();
for (const serial of serials) {
  run('npx', [
    'playwright', 'test',
    '--config', 'tests/e2e/native-app/playwright.config.ts',
    'tests/e2e/native-app/34-android-portable-core-contracts.spec.ts',
  ], {
    E2E_REAL_ANDROID_CORE: '1',
    NATIVE_APP_ANDROID_SERIAL: serial,
    NATIVE_APP_ANDROID_HOST: host,
  });
}

process.stdout.write(`\n[android-core] PASS: host parity plus ${serials.length} Android device(s).\n`);
