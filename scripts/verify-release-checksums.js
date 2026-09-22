#!/usr/bin/env node
'use strict';

/**
 * OPEN-30: verifies a SHA256SUMS manifest against either a local directory or a live deployment,
 * so publishing checksums (generate-web-checksums.js, stage-app-download.mjs) is actually
 * checkable rather than a file nobody reads. Exits non-zero on any mismatch/missing file, so it
 * can gate a deploy step or run as a periodic manual/cron check.
 *
 * Usage:
 *   node scripts/verify-release-checksums.js --dir dist/web
 *     Re-hashes every file under --dir and compares against <dir>/SHA256SUMS.
 *
 *   node scripts/verify-release-checksums.js --base-url https://www.iinpublic.com
 *     Fetches https://www.iinpublic.com/SHA256SUMS, then fetches and hashes every file it lists
 *     from the same origin, and reports any mismatch — this is the "does what's actually being
 *     served right now match a specific reviewed build" check (docs/security/
 *     techsupport-and-user-production-security.md, OPEN-30's release-integrity roadmap item).
 *     Does not require server-side code; it only reads already-public static files.
 *
 * Either mode accepts --manifest <path-or-url> to check against a manifest OTHER than the one
 * colocated with the target (e.g. a manifest saved from a known-good release, to catch a live
 * site that has silently drifted from what was actually reviewed/tagged).
 */
const fs = require('fs');
const path = require('path');
const { sha256File, parseManifest } = require('./lib/sha256sums');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Option --${name} requires a value.`);
    out[name] = value;
    i += 1;
  }
  return out;
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

async function fetchSha256(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function verifyLocalDir(dir, manifestSource) {
  const manifestText = manifestSource
    ? fs.readFileSync(path.resolve(manifestSource), 'utf8')
    : fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
  const entries = parseManifest(manifestText);
  const failures = [];
  for (const { hash, relPath } of entries) {
    const filePath = path.join(dir, relPath);
    if (!fs.existsSync(filePath)) {
      failures.push(`MISSING  ${relPath}`);
      continue;
    }
    const actual = sha256File(filePath);
    if (actual !== hash) failures.push(`MISMATCH ${relPath} (expected ${hash}, got ${actual})`);
  }
  return { checked: entries.length, failures };
}

async function verifyBaseUrl(baseUrl, manifestSource) {
  const origin = baseUrl.replace(/\/+$/, '');
  const manifestText = manifestSource
    ? /^https?:\/\//i.test(manifestSource)
      ? await fetchText(manifestSource)
      : fs.readFileSync(path.resolve(manifestSource), 'utf8')
    : await fetchText(`${origin}/SHA256SUMS`);
  const entries = parseManifest(manifestText);
  const failures = [];
  for (const { hash, relPath } of entries) {
    if (relPath === 'SHA256SUMS') continue; // the manifest never lists/hashes itself
    try {
      const actual = await fetchSha256(`${origin}/${relPath}`);
      if (actual !== hash) failures.push(`MISMATCH ${relPath} (expected ${hash}, got ${actual})`);
    } catch (err) {
      failures.push(`UNREACHABLE ${relPath} (${err.message})`);
    }
  }
  return { checked: entries.length, failures };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dir && !options['base-url']) {
    console.error('Usage: node scripts/verify-release-checksums.js --dir <path> | --base-url <url> [--manifest <path-or-url>]');
    process.exitCode = 1;
    return;
  }
  const result = options.dir
    ? await verifyLocalDir(path.resolve(options.dir), options.manifest)
    : await verifyBaseUrl(options['base-url'], options.manifest);

  console.log(`[verify-release-checksums] checked ${result.checked} file(s)`);
  if (result.failures.length > 0) {
    for (const line of result.failures) console.error(`  ${line}`);
    console.error(`[verify-release-checksums] FAILED: ${result.failures.length} mismatch(es)/missing file(s)`);
    process.exitCode = 1;
    return;
  }
  console.log('[verify-release-checksums] OK — every listed file matches.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[verify-release-checksums] failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { verifyLocalDir, verifyBaseUrl, parseArgs };
