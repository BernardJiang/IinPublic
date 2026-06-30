#!/usr/bin/env node
/**
 * S3 embedded-node: stamp a matching build-id into dist/web and dist/server.
 *
 * "Desktop autoupdate: ship UI + node together; never let dist/web and
 * dist/server drift across an update" (docs/TODO.md). electron-builder
 * packages both as extraResources of the SAME app bundle, so a normal
 * autoupdate already replaces them atomically as one unit — but that's a
 * packaging *convention*, not something enforced at runtime. If a build ever
 * ships partially (e.g. a CI step fails between `build:web` and
 * `build:server`, or someone manually copies one half of `dist/` into an
 * existing install), the UI and the embedded node could silently disagree
 * about API/Gun-graph shape with no signal to the user or the logs.
 *
 * This script writes the SAME build-id (git short SHA if available, else a
 * timestamp+random fallback) into both build outputs right after they're
 * produced:
 *   - dist/web/build-id.json   (served as a static file by the embedded node)
 *   - dist/server/server/build-id.json (read by this same server at boot)
 *
 * `src/server/bootstrap/http-bootstrap.ts` compares the two at startup, in
 * embedded mode only, and logs a loud warning (not a crash — a stale/missing
 * UI build-id should not block the node from serving) if they don't match.
 *
 * Run via `npm run build:embedded` (after build:web + build:server).
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function resolveBuildId() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    // Not a git checkout (e.g. extracted release tarball) — fall through.
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function writeStamp(targetDir, label) {
  if (!fs.existsSync(targetDir)) {
    console.warn(`[stamp-build-id] skipping ${label}: ${targetDir} does not exist (build it first)`);
    return false;
  }
  const stampPath = path.join(targetDir, 'build-id.json');
  fs.writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
  console.log(`[stamp-build-id] wrote ${label} -> ${stampPath}`);
  return true;
}

const stamp = {
  buildId: resolveBuildId(),
  builtAt: new Date().toISOString(),
};

const webOk = writeStamp(path.join(repoRoot, 'dist', 'web'), 'dist/web');
// Matches src/server/tsconfig.json outDir (../../dist/server) + rootDir (src),
// so src/server/index.ts -> dist/server/server/index.js.
const serverOk = writeStamp(path.join(repoRoot, 'dist', 'server', 'server'), 'dist/server/server');

if (!webOk || !serverOk) {
  console.error('[stamp-build-id] one or both build outputs are missing — run build:web and build:server first.');
  process.exit(1);
}

console.log(`[stamp-build-id] buildId=${stamp.buildId}`);
