#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const version = rootPackage.version;
const platform = process.argv[2];
const explicitSource = process.argv[3];

const platformRules = {
  windows: { extensions: ['.exe'], outputExtension: '.exe' },
  mac: { extensions: ['.dmg'], outputExtension: '.dmg' },
  linux: { extensions: ['.appimage', '.deb'], outputExtension: null },
  android: { extensions: ['.apk'], outputExtension: '.apk' },
  ios: { extensions: ['.ipa'], outputExtension: '.ipa' },
};

if (!Object.hasOwn(platformRules, platform)) {
  console.error('Usage: node scripts/stage-app-download.mjs <windows|mac|linux|android|ios> [artifact]');
  process.exit(1);
}

const rule = platformRules[platform];
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const versionPattern = new RegExp(`(^|[^0-9])${escapedVersion}([^0-9]|$)`);

function discoverDesktopArtifact() {
  const distDir = path.join(projectRoot, 'platforms', 'desktop', 'dist');
  const files = fs.existsSync(distDir) ? fs.readdirSync(distDir) : [];
  const matches = files.filter((filename) => {
    const lower = filename.toLowerCase();
    return versionPattern.test(filename)
      && rule.extensions.some((extension) => lower.endsWith(extension));
  });
  return matches.sort((left, right) => left.localeCompare(right, undefined, { numeric: true })).at(-1)
    ? path.join(distDir, matches.at(-1))
    : null;
}

function discoverAndroidArtifact() {
  const outputDir = path.join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug');
  const metadataPath = path.join(outputDir, 'output-metadata.json');
  if (!fs.existsSync(metadataPath)) return null;
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.elements?.[0]?.versionName !== version) {
    throw new Error(`Android APK metadata is ${metadata.elements?.[0]?.versionName ?? 'unknown'}, expected ${version}`);
  }
  const outputFile = metadata.elements?.[0]?.outputFile;
  return outputFile ? path.join(outputDir, outputFile) : null;
}

let sourcePath = explicitSource ? path.resolve(projectRoot, explicitSource) : null;
if (!sourcePath) {
  sourcePath = platform === 'android' ? discoverAndroidArtifact() : discoverDesktopArtifact();
}
if (!sourcePath || !fs.existsSync(sourcePath)) {
  throw new Error(`No ${platform} artifact built for version ${version} was found`);
}

const sourceExtension = path.extname(sourcePath);
if (!rule.extensions.includes(sourceExtension.toLowerCase())) {
  throw new Error(`${sourcePath} is not a supported ${platform} artifact`);
}
if (platform !== 'android' && !versionPattern.test(path.basename(sourcePath))) {
  throw new Error(`Artifact filename must contain release version ${version}: ${path.basename(sourcePath)}`);
}

const outputExtension = rule.outputExtension || sourceExtension;
const downloadsDir = path.join(projectRoot, 'public', 'downloads');
const destination = path.join(downloadsDir, `IinPublic-${version}-${platform}${outputExtension}`);
fs.mkdirSync(downloadsDir, { recursive: true });
fs.copyFileSync(sourcePath, destination);
console.log(`Staged ${path.relative(projectRoot, destination)} from ${path.relative(projectRoot, sourcePath)}`);
