'use strict';

/**
 * OPEN-30: shared SHA-256 manifest helpers, used by `generate-web-checksums.js` (dist/web) and
 * `stage-app-download.mjs` (public/downloads — desktop installers + Android APK). One small
 * module rather than duplicating the same walk/hash/format logic in both build scripts.
 *
 * Manifest format is the standard `sha256sum`-compatible `<hex-hash>  <relative-path>` (two
 * spaces, POSIX-style forward-slash paths regardless of host OS) so `sha256sum -c SHA256SUMS`
 * works unmodified for anyone verifying a downloaded release by hand.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/** Recursively lists every file (not directory) under `dir`, as absolute paths. */
function walkFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** entries: [{ hash, relPath }], relPath using forward slashes regardless of host OS. */
function formatManifest(entries) {
  const lines = entries
    .slice()
    .sort((a, b) => a.relPath.localeCompare(b.relPath))
    .map((e) => `${e.hash}  ${e.relPath}`);
  return lines.length ? lines.join('\n') + '\n' : '';
}

/** Hashes every file under `dir` (excluding `manifestName` itself, so regenerating never hashes
 * its own prior output) and writes `<dir>/<manifestName>`. Returns the entry list written. */
function generateManifestForDir(dir, manifestName = 'SHA256SUMS') {
  const files = walkFiles(dir).filter((f) => path.basename(f) !== manifestName);
  const entries = files.map((full) => ({
    hash: sha256File(full),
    relPath: path.relative(dir, full).split(path.sep).join('/'),
  }));
  fs.writeFileSync(path.join(dir, manifestName), formatManifest(entries));
  return entries;
}

/** Parses a `sha256sum`-format manifest text into [{ hash, relPath }]. Ignores blank lines. */
function parseManifest(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([0-9a-f]{64})\s{2}(.+)$/i);
      if (!match) throw new Error(`Malformed SHA256SUMS line: ${line}`);
      return { hash: match[1].toLowerCase(), relPath: match[2] };
    });
}

module.exports = { sha256File, walkFiles, formatManifest, generateManifestForDir, parseManifest };
