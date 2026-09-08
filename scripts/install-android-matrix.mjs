#!/usr/bin/env node

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(repoRoot, 'tests', 'matrix', 'devices.json');
const apkPath = path.join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const devices = Array.isArray(config.android) ? config.android : [];
const installTimeoutMs = Number(process.env.ANDROID_INSTALL_TIMEOUT_MS || '300000');

if (devices.length === 0) throw new Error(`${configPath} does not configure any Android devices`);
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

const failures = [];
for (const device of devices) {
  console.log(`[android-matrix] installing ${device.name} (${device.serial})`);
  try {
    execFileSync('adb', ['-s', device.serial, 'install', '--no-streaming', '-r', apkPath], {
      cwd: repoRoot,
      stdio: 'inherit',
      timeout: installTimeoutMs,
      killSignal: 'SIGTERM',
    });
  } catch (error) {
    const timedOut = error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM';
    const reason = timedOut
      ? `timed out after ${installTimeoutMs}ms`
      : `failed${error?.status == null ? '' : ` with exit code ${error.status}`}`;
    failures.push(`${device.name} (${device.serial}): ${reason}`);
    console.error(`[android-matrix] ${reason}; continuing to the next configured device`);
  }
}

if (failures.length) {
  throw new Error(`Android matrix installation incomplete:\n- ${failures.join('\n- ')}`);
}
