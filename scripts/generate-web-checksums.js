#!/usr/bin/env node
'use strict';

/**
 * OPEN-30: writes `dist/web/SHA256SUMS`, a per-file SHA-256 manifest of the built web bundle.
 * The embedded-node server serves `dist/web` wholesale (S3 embedded-node), so this manifest
 * itself is servable too (e.g. `GET /SHA256SUMS`) — anyone can `curl` it plus the files it
 * lists and confirm what a running deployment actually serves matches this specific build,
 * without needing any special endpoint or trusting the server's own word for it.
 *
 * Run as part of `npm run build:embedded`, after `build:web` and `stamp-build-id.js` (so the
 * manifest also covers `build-id.json`) and before packaging/deploying. Re-run and re-deploy
 * together — a stale manifest that doesn't match the live files is worse than no manifest, since
 * it invites a false "verified" conclusion.
 *
 * Honest limits (see docs/security/techsupport-and-user-production-security.md, OPEN-30): this
 * detects an in-transit or at-rest modification AFTER the build step, and a mismatch you notice
 * because you fetched and compared. It does not protect against a compromised build machine
 * producing a bad manifest in the first place, and nothing forces a periodic re-check — that
 * remains a manual or externally-scheduled step until real usage justifies automating it.
 */
const path = require('path');
const { generateManifestForDir } = require('./lib/sha256sums');

const ROOT = path.join(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'dist', 'web');

function main() {
  const entries = generateManifestForDir(WEB_DIR, 'SHA256SUMS');
  console.log(`[generate-web-checksums] wrote ${path.join(WEB_DIR, 'SHA256SUMS')} (${entries.length} files)`);
}

main();
