#!/usr/bin/env node

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, 'tests', 'matrix', 'devices.json');
const apkPath = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const configuredDevices = Array.isArray(config.android) ? config.android : [];
const selectedNames = String(process.env.NATIVE_APP_ANDROID_NAMES || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);
const selectedSerials = String(process.env.NATIVE_APP_ANDROID_SERIALS || '')
  .split(',')
  .map((serial) => serial.trim())
  .filter(Boolean);
const byName = new Map(configuredDevices.map((device) => [device.name, device]));
const bySerial = new Map(configuredDevices.map((device) => [device.serial, device]));
if (selectedNames.length && selectedSerials.length) {
  throw new Error('Select Android devices with NATIVE_APP_ANDROID_NAMES or NATIVE_APP_ANDROID_SERIALS, not both');
}
const devices = selectedNames.length
  ? selectedNames.map((name) => {
      const device = byName.get(name);
      if (!device) throw new Error(`Unknown Android logical name ${name}; choose ${[...byName.keys()].join(', ')}`);
      return device;
    })
  : selectedSerials.length
    ? selectedSerials.map((serial, index) => bySerial.get(serial) ?? ({ name: `android-${index + 1}`, serial }))
  : configuredDevices;
const installTimeoutMs = Number(process.env.ANDROID_INSTALL_TIMEOUT_MS || '300000');

if (devices.length === 0) throw new Error(`${configPath} does not configure any selected Android devices`);
if (!fs.existsSync(apkPath)) throw new Error(`Missing ${apkPath}; run npm run android:build first`);
if (!Number.isFinite(installTimeoutMs) || installTimeoutMs <= 0) {
  throw new Error(`ANDROID_INSTALL_TIMEOUT_MS must be a positive number; received ${process.env.ANDROID_INSTALL_TIMEOUT_MS}`);
}

const adbOutput = execFileSync('adb', ['devices'], { encoding: 'utf8' });
const connected = new Set(
  adbOutput.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/)).filter((row) => row[1] === 'device').map((row) => row[0]),
);
const missing = devices.filter((device) => !connected.has(device.serial));
if (missing.length) {
  throw new Error(`Configured devices are unavailable: ${missing.map((device) => `${device.name} (${device.serial})`).join(', ')}`);
}

// A sweep installs the same APK more than once (after the mixed-release gate, and again as its
// final restore). Phones whose installed base.apk already has this APK's MD5 are skipped
// (ANDROID_INSTALL_FORCE=1 reinstalls). The rest install one at a time: the test phones share one
// USB hub, and four parallel installs of the 204 MB APK all but one timed out at 5 min.
const force = process.env.ANDROID_INSTALL_FORCE === '1';
const localMd5 = crypto.createHash('md5').update(fs.readFileSync(apkPath)).digest('hex');

function installedMd5(serial) {
  try {
    const apk = execFileSync('adb', ['-s', serial, 'shell', 'pm', 'path', 'com.iinpublic.app'], { encoding: 'utf8', timeout: 15_000 })
      .split(/\r?\n/).find((line) => line.startsWith('package:'))?.slice('package:'.length).trim();
    if (!apk) return '';
    const out = execFileSync('adb', ['-s', serial, 'shell', 'md5sum', apk], { encoding: 'utf8', timeout: 60_000 });
    return out.trim().split(/\s+/)[0] || '';
  } catch {
    return '';
  }
}

function install(device) {
  try {
    execFileSync('adb', ['-s', device.serial, 'install', '--no-streaming', '-r', apkPath], {
      cwd: repoRoot,
      stdio: 'inherit',
      timeout: installTimeoutMs,
      killSignal: 'SIGTERM',
    });
    return '';
  } catch (error) {
    const timedOut = error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM';
    return timedOut ? `timed out after ${installTimeoutMs}ms` : `failed${error?.status == null ? '' : ` with exit code ${error.status}`}`;
  }
}

const pending = [];
for (const device of devices) {
  if (!force && installedMd5(device.serial) === localMd5) {
    console.log(`[android-matrix] ${device.name} (${device.serial}) already has this APK (md5 ${localMd5.slice(0, 12)}); skipped`);
  } else {
    pending.push(device);
  }
}
const startedAt = Date.now();
const results = pending.map((device) => {
  console.log(`[android-matrix] installing ${device.name} (${device.serial})`);
  const failure = install(device);
  if (failure) console.error(`[android-matrix] ${failure}; continuing to the next configured device`);
  return failure;
});
const failures = pending.flatMap((device, index) => results[index] ? [`${device.name} (${device.serial}): ${results[index]}`] : []);
if (pending.length) console.log(`[android-matrix] ${pending.length - failures.length} of ${pending.length} install(s) done in ${Math.round((Date.now() - startedAt) / 1000)}s`);

if (failures.length) {
  throw new Error(`Android matrix installation incomplete:\n- ${failures.join('\n- ')}`);
}
