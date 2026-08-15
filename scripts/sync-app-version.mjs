#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
  fs.writeFileSync(path.join(projectRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`);
}

const rootPackage = readJson('package.json');
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(rootPackage.version);
if (!versionMatch) {
  throw new Error(`Release version must be numeric SemVer (x.y.z), got ${rootPackage.version}`);
}

const [, majorText, minorText, patchText] = versionMatch;
const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
if (major > 2099 || minor > 999 || patch > 999) {
  throw new Error('Version components exceed the Android/iOS build-number encoding limits');
}

// Monotonic integer for Android. iOS accepts the numeric SemVer directly.
const buildNumber = major * 1_000_000 + minor * 1_000 + patch;
const mismatches = [];

if (
  checkOnly
  && process.env.GITHUB_REF_TYPE === 'tag'
  && process.env.GITHUB_REF_NAME !== `v${rootPackage.version}`
) {
  mismatches.push(
    `release tag: ${process.env.GITHUB_REF_NAME ?? '(missing)'} -> v${rootPackage.version}`,
  );
}

function syncJsonVersion(relativePath, nested = false) {
  const value = readJson(relativePath);
  const current = nested ? value.packages?.['']?.version : value.version;
  if (current !== rootPackage.version) {
    mismatches.push(`${relativePath}: ${current ?? '(missing)'} -> ${rootPackage.version}`);
    if (!checkOnly) {
      if (nested) value.packages[''].version = rootPackage.version;
      else value.version = rootPackage.version;
      writeJson(relativePath, value);
    }
  }
}

syncJsonVersion('package-lock.json');
syncJsonVersion('package-lock.json', true);
syncJsonVersion('platforms/desktop/package.json');
syncJsonVersion('platforms/desktop/package-lock.json');
syncJsonVersion('platforms/desktop/package-lock.json', true);

const gradlePath = 'android/app/build.gradle';
let gradle = fs.readFileSync(path.join(projectRoot, gradlePath), 'utf8');
const gradleVersionCode = Number(/versionCode\s+(\d+)/.exec(gradle)?.[1]);
const gradleVersionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
if (gradleVersionCode !== buildNumber || gradleVersionName !== rootPackage.version) {
  mismatches.push(
    `${gradlePath}: ${gradleVersionName}/${gradleVersionCode} -> ${rootPackage.version}/${buildNumber}`,
  );
  if (!checkOnly) {
    gradle = gradle
      .replace(/versionCode\s+\d+/, `versionCode ${buildNumber}`)
      .replace(/versionName\s+"[^"]+"/, `versionName "${rootPackage.version}"`);
    fs.writeFileSync(path.join(projectRoot, gradlePath), gradle);
  }
}

const plistPath = 'platforms/ios/Info.plist';
let plist = fs.readFileSync(path.join(projectRoot, plistPath), 'utf8');
const plistVersion = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
const plistBuild = /<key>CFBundleVersion<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1];
if (plistVersion !== rootPackage.version || plistBuild !== rootPackage.version) {
  mismatches.push(`${plistPath}: ${plistVersion}/${plistBuild} -> ${rootPackage.version}/${rootPackage.version}`);
  if (!checkOnly) {
    plist = plist
      .replace(
        /(<key>CFBundleShortVersionString<\/key>\s*<string>)[^<]+(<\/string>)/,
        `$1${rootPackage.version}$2`,
      )
      .replace(
        /(<key>CFBundleVersion<\/key>\s*<string>)[^<]+(<\/string>)/,
        `$1${rootPackage.version}$2`,
      );
    fs.writeFileSync(path.join(projectRoot, plistPath), plist);
  }
}

if (checkOnly && mismatches.length > 0) {
  console.error(`App version drift detected (source version: ${rootPackage.version}):`);
  for (const mismatch of mismatches) console.error(`- ${mismatch}`);
  process.exitCode = 1;
} else if (mismatches.length > 0) {
  console.log(`Synchronized all app versions to ${rootPackage.version} (build ${buildNumber}).`);
  for (const mismatch of mismatches) console.log(`- ${mismatch}`);
} else {
  console.log(`All app versions match ${rootPackage.version} (build ${buildNumber}).`);
}
