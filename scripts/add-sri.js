#!/usr/bin/env node
'use strict';

/**
 * OPEN-30: adds Subresource Integrity (`integrity`/`crossorigin` attributes) to `dist/web/
 * index.html`'s locally-served `<script>` tags, over the checksum manifest
 * (`generate-web-checksums.js`) — SRI is browser-ENFORCED (a tampered file fails to execute at
 * all) rather than something a human/monitor has to separately fetch and compare.
 *
 * Run as part of `npm run build:embedded`, after `build:web` and BEFORE
 * `generate-web-checksums.js` — the checksum manifest must hash the SRI-patched index.html, the
 * file actually served, not a pre-patch copy (see the manifest script's own "a stale manifest ...
 * is worse than no manifest" warning).
 *
 * Deliberately scoped to index.html's own statically-referenced entry scripts only
 * (`startup-head.js`, webpack's own `bundle.js` entry) — NOT webpack's dynamically-imported async
 * chunks (maplibre-gl, helia/IPFS, libp2p, ...), which this app has many of via code-splitting.
 * Covering those correctly needs a dedicated webpack plugin
 * (`webpack-subresource-integrity`) wired through `output.crossOriginLoading` and the runtime
 * chunk-loading manifest — real, separate build-pipeline work (this file's own doc comment
 * anticipated exactly this split). A wrong/stale integrity hash on an async chunk fails silently
 * differently (the chunk import rejects at runtime, potentially breaking a feature for every user
 * of a legitimate release) rather than failing loudly and safely the way a bad entry-script hash
 * does, so it is not something to bolt on casually. The entry script is still the thing directly,
 * statically reachable from the HTML a browser first loads — the most direct tamper target.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'dist', 'web');
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_PATH = path.join(WEB_DIR, 'index.html');

// Each script's real source directory — `bundle.js` is webpack's own output (dist/web), but
// `startup-head.js` is a small static bootstrap file served straight from `public/` at the same
// URL path (see src/server/bootstrap/http-bootstrap.ts's static mounts); it is never copied into
// dist/web. Both resolve to the same runtime URL either way, so index.html's own `src="..."`
// stays a plain relative filename regardless of which directory actually holds the bytes.
const SOURCE_DIR_BY_FILE = {
  'startup-head.js': PUBLIC_DIR,
  'bundle.js': WEB_DIR,
};

function sriHashFor(filePath) {
  const bytes = fs.readFileSync(filePath);
  const digest = crypto.createHash('sha384').update(bytes).digest('base64');
  return `sha384-${digest}`;
}

/** Adds integrity/crossorigin to one `<script ... src="local.js" ...>` tag, in place. Only
 * touches a tag whose src is a plain local filename (no scheme, no leading slash) — this
 * template never references a CDN script, and a scheme-qualified src is deliberately left
 * untouched rather than guessed at. `sourceDir` is the real directory holding `srcFile`'s bytes
 * (an explicit parameter, not read off the module-level `SOURCE_DIR_BY_FILE` map, so this stays
 * unit-testable against a throwaway fixture directory independent of this repo's own layout). */
function patchScriptTag(html, srcFile, sourceDir, indexPathForErrors = '<index.html>') {
  const re = new RegExp(`<script([^>]*?)\\ssrc="${srcFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"([^>]*)>`);
  const match = html.match(re);
  if (!match) {
    throw new Error(`add-sri: expected to find <script src="${srcFile}"> in ${indexPathForErrors}`);
  }
  const filePath = path.join(sourceDir, srcFile);
  if (!fs.existsSync(filePath)) {
    throw new Error(`add-sri: ${srcFile} is referenced in index.html but missing from ${sourceDir}`);
  }
  const integrity = sriHashFor(filePath);
  const [full, before, after] = match;
  if (/\sintegrity=/.test(full)) return html; // already patched (idempotent re-run)
  const replacement = `<script${before} src="${srcFile}" integrity="${integrity}" crossorigin="anonymous"${after}>`;
  return html.replace(full, replacement);
}

function main() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`add-sri: ${INDEX_PATH} not found — run \`npm run build:web\` first.`);
  }
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  const patched = [];
  for (const [srcFile, sourceDir] of Object.entries(SOURCE_DIR_BY_FILE)) {
    const before = html;
    html = patchScriptTag(html, srcFile, sourceDir, INDEX_PATH);
    if (html !== before) patched.push(srcFile);
  }
  fs.writeFileSync(INDEX_PATH, html);
  console.log(
    patched.length
      ? `[add-sri] added integrity to: ${patched.join(', ')}`
      : '[add-sri] index.html already has integrity attributes — nothing to do',
  );
}

if (require.main === module) main();

module.exports = { sriHashFor, patchScriptTag, main };
