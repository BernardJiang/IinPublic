#!/usr/bin/env node

// docs/TODO.md OPEN-33: electron-updater's `generic` provider (platforms/desktop/package.json's
// `build.publish`) needs `latest.yml` (Windows), `latest-mac.yml` (macOS), or `latest-linux.yml`
// (Linux) reachable at the SAME origin/path it downloads the installer from
// (https://www.iinpublic.com/downloads/) — this repo already stages installers there under a
// human-friendly renamed filename (IinPublic-<version>-<platform>.<ext>, stage-app-download.mjs),
// which the auto-updater manifest does NOT reference; it names the exact file electron-builder
// itself produced. Rather than reimplementing or guessing that naming, this script reads it
// straight out of the real, just-built manifest (the actual source of truth) and stages the
// manifest plus every file it references, unmodified, alongside the renamed copy — so both the
// app's own /downloads page (renamed name) and the in-app auto-updater (electron-builder's own
// name) keep working from the exact same directory.
//
// Usage: node scripts/stage-autoupdate-manifest.mjs <mac|windows|linux>

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

export const MANIFEST_BY_PLATFORM = {
  mac: 'latest-mac.yml',
  windows: 'latest.yml',
  linux: 'latest-linux.yml',
};

/** Every filename an electron-builder update manifest actually references — its own top-level
 * `path`, plus each `files[].url` (electron-builder sometimes lists more than one artifact, e.g.
 * a zip alongside the installer). De-duplicated. Pure — no filesystem access — so this is the
 * unit-testable core; `stageAutoupdateManifest` below does the actual I/O and validation. */
export function filesReferencedByManifest(manifest) {
  const referenced = new Set();
  if (manifest && typeof manifest.path === 'string') referenced.add(manifest.path);
  for (const entry of manifest && Array.isArray(manifest.files) ? manifest.files : []) {
    if (entry && typeof entry.url === 'string') referenced.add(entry.url);
  }
  return [...referenced];
}

/** True for a plain filename with no directory traversal — the only shape ever trusted from a
 * manifest before it's used to build a filesystem path. */
export function isSafeManifestFilename(filename) {
  return typeof filename === 'string' && filename.length > 0
    && !filename.includes('/') && !filename.includes('\\') && !filename.includes('..');
}

/** Copies a platform's update manifest and every file it references from `desktopDistDir` to
 * `downloadsDir`. Throws (never exits the process itself) on any missing/unsafe file, so a
 * caller — the CLI below, or a test — controls how that surfaces. */
export function stageAutoupdateManifest({ platform, desktopDistDir, downloadsDir, fs: fsImpl = fs, yaml: yamlImpl = yaml }) {
  const manifestName = MANIFEST_BY_PLATFORM[platform];
  if (!manifestName) {
    throw new Error(`Unknown platform "${platform}" — expected one of ${Object.keys(MANIFEST_BY_PLATFORM).join(', ')}`);
  }
  const manifestPath = path.join(desktopDistDir, manifestName);
  if (!fsImpl.existsSync(manifestPath)) {
    throw new Error(
      `${manifestPath} not found — build the ${platform} desktop installer first ` +
        '(electron-builder writes this alongside the installer on every build).',
    );
  }
  const manifest = yamlImpl.load(fsImpl.readFileSync(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object') {
    throw new Error(`${manifestName} did not parse to an object`);
  }
  const referencedFiles = filesReferencedByManifest(manifest);
  fsImpl.mkdirSync(downloadsDir, { recursive: true });
  for (const filename of referencedFiles) {
    if (!isSafeManifestFilename(filename)) {
      throw new Error(`refusing suspicious filename in manifest: ${filename}`);
    }
    const source = path.join(desktopDistDir, filename);
    if (!fsImpl.existsSync(source)) {
      throw new Error(`${manifestName} references ${filename}, but it's missing from ${desktopDistDir}`);
    }
    fsImpl.copyFileSync(source, path.join(downloadsDir, filename));
  }
  fsImpl.copyFileSync(manifestPath, path.join(downloadsDir, manifestName));
  return { manifestName, stagedFiles: referencedFiles };
}

function main() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const desktopDistDir = path.join(projectRoot, 'platforms', 'desktop', 'dist');
  const downloadsDir = process.env.IINPUBLIC_DOWNLOADS_DIR
    ? path.resolve(process.env.IINPUBLIC_DOWNLOADS_DIR)
    : path.join(projectRoot, 'public', 'downloads');
  const platform = process.argv[2];
  if (!Object.hasOwn(MANIFEST_BY_PLATFORM, platform)) {
    console.error('Usage: node scripts/stage-autoupdate-manifest.mjs <mac|windows|linux>');
    process.exit(1);
  }
  try {
    const { manifestName, stagedFiles } = stageAutoupdateManifest({ platform, desktopDistDir, downloadsDir });
    console.log(
      `[stage-autoupdate-manifest] staged ${manifestName} + ${stagedFiles.length} referenced file(s) ` +
        `(${stagedFiles.join(', ')}) to ${downloadsDir}`,
    );
  } catch (err) {
    console.error(`stage-autoupdate-manifest: ${err.message}`);
    process.exit(1);
  }
}

// import.meta.main isn't available on every Node version this project supports yet — compare
// against process.argv[1] instead, the portable equivalent of Node's CJS require.main check.
if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
