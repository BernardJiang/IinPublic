#!/usr/bin/env node
/**
 * Mobile-bundle smoke test — sibling of scripts/smoke-embedded-node.js, but exercises the
 * BUNDLED artifact scripts/build-embedded-mobile.js produces
 * (dist/embedded-mobile/server/node-app/embedded-node.js) in the layout Android/iOS actually
 * unpack on-device: node_modules/gun staged as a SIBLING of the bundle (main.js's role is played
 * by directly spawning the bundle here), with IINPUBLIC_DATA_DIR pointed at that SAME directory
 * (data dir == install dir on mobile — see NodeForegroundService.kt / NodeBridge.kt).
 *
 * This distinction matters: `smoke-embedded-node.js` deliberately keeps its temp data dir
 * SEPARATE from the repo root it spawns from (mirroring desktop, where app-install-dir and
 * user-data-dir are conventionally different directories) — Gun's own `Gun.serve` middleware
 * happens to paper over that gap by resolving its bundled gun.js/sea.js via `__dirname` relative
 * to gun's OWN unbundled package location, not `process.cwd()`. Once gun.js is bundled into the
 * SAME single file as the rest of the server (this script's target), that `__dirname` fallback
 * breaks (there's no separate `node_modules/gun/lib/serve.js` on disk anymore for it to resolve
 * against) — the explicit `express.static('/node_modules/gun', gunRoot)` mount in
 * http-bootstrap.ts becomes the ONLY thing serving gun.js/sea.js to the browser Worker, and IT
 * depends on `node_modules/gun` genuinely being on disk relative to `process.cwd()`. This script
 * asserts that mount keeps working with the bundled server + the real on-device layout.
 *
 * Usage: node scripts/smoke-embedded-node-mobile.js
 * Exit code 0 = pass, non-zero = fail.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const nodeEntry = path.join(repoRoot, 'dist', 'embedded-mobile', 'server', 'node-app', 'embedded-node.js');
const webRoot = path.join(repoRoot, 'dist', 'web');
const publicRoot = path.join(repoRoot, 'public');
const gunPackageRoot = path.join(repoRoot, 'node_modules', 'gun');
const PORT = parseInt(process.env.SMOKE_PORT || '18098', 10);

function fail(message) {
  console.error(`[smoke-mobile] FAIL: ${message}`);
  process.exitCode = 1;
}

function httpGet(p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`GET ${p} timed out`)); });
  });
}

async function waitForServer(deadlineMs = 20000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const res = await httpGet('/health');
      if (res.statusCode && res.statusCode < 500) return;
    } catch {
      // not up yet
    }
    if (Date.now() - start > deadlineMs) {
      throw new Error(`server did not become healthy within ${deadlineMs}ms`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function main() {
  if (!fs.existsSync(nodeEntry)) {
    fail(`missing build artifact: ${nodeEntry} — run "npm run build:embedded-mobile" first`);
    return;
  }
  if (!fs.existsSync(webRoot)) {
    fail(`missing build artifact: ${webRoot} — run "npm run build:web" first`);
    return;
  }
  if (!fs.existsSync(gunPackageRoot)) {
    fail(`missing node_modules/gun — run "npm ci" first`);
    return;
  }

  // Mirror the on-device unpack: node_modules/gun staged as a sibling of the bundle, in the
  // SAME directory IINPUBLIC_DATA_DIR points at.
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-embedded-mobile-smoke-'));
  fs.mkdirSync(path.join(stageDir, 'node_modules'), { recursive: true });
  fs.cpSync(gunPackageRoot, path.join(stageDir, 'node_modules', 'gun'), { recursive: true });

  const child = spawn(process.execPath, [nodeEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      IINPUBLIC_EMBEDDED_NODE: '1',
      IINPUBLIC_PLATFORM: 'android',
      IINPUBLIC_LOCAL_PORT: String(PORT),
      PORT: String(PORT),
      IINPUBLIC_WEB_ROOT: webRoot,
      IINPUBLIC_PUBLIC_ROOT: publicRoot,
      IINPUBLIC_DATA_DIR: stageDir,
      IINPUBLIC_LOOPBACK_ONLY: '1',
      NODE_ENV: process.env.NODE_ENV || 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let combinedOutput = '';
  child.stdout.on('data', (d) => { combinedOutput += d.toString(); });
  child.stderr.on('data', (d) => { combinedOutput += d.toString(); });

  let crashed = false;
  child.on('exit', (code, sig) => {
    if (code !== null && code !== 0) {
      crashed = true;
      fail(`embedded-node process exited early (code=${code} sig=${sig})\n${combinedOutput.slice(-4000)}`);
    }
  });

  try {
    await waitForServer();
  } catch (err) {
    fail(`${err.message}\n--- server output ---\n${combinedOutput.slice(-4000)}`);
    try { child.kill('SIGTERM'); } catch { /* ignore */ }
    return;
  }

  if (crashed) return;

  try {
    const health = await httpGet('/health');
    if (!health.statusCode || health.statusCode >= 300) fail(`GET /health returned ${health.statusCode}`);
    else console.log(`[smoke-mobile] GET /health -> ${health.statusCode} OK`);

    const root = await httpGet('/');
    if (!root.statusCode || root.statusCode >= 300) fail(`GET / returned ${root.statusCode}`);
    else if (!/<html/i.test(root.body)) fail('GET / did not return HTML (SPA index.html not served)');
    else console.log(`[smoke-mobile] GET / -> ${root.statusCode} OK (serves SPA)`);

    const worker = await httpGet('/worker.js');
    if (!worker.statusCode || worker.statusCode >= 300) fail(`GET /worker.js returned ${worker.statusCode}`);
    else if (!/Gun\.js Web Worker/.test(worker.body)) fail('GET /worker.js did not return the app worker');
    else console.log(`[smoke-mobile] GET /worker.js -> ${worker.statusCode} OK`);

    // The two files public/worker.js actually importScripts() at runtime — this is the exact
    // path a real device's Web Worker depends on to get SEA/IndexedDB working (see this file's
    // header comment for why bundling breaks Gun's own __dirname-based serving fallback).
    const gunJs = await httpGet('/node_modules/gun/gun.js');
    if (!gunJs.statusCode || gunJs.statusCode >= 300) fail(`GET /node_modules/gun/gun.js returned ${gunJs.statusCode}`);
    else if (!/function Gun/.test(gunJs.body)) fail('GET /node_modules/gun/gun.js did not return Gun.js');
    else console.log(`[smoke-mobile] GET /node_modules/gun/gun.js -> ${gunJs.statusCode} OK`);

    const seaJs = await httpGet('/node_modules/gun/sea.js');
    if (!seaJs.statusCode || seaJs.statusCode >= 300) fail(`GET /node_modules/gun/sea.js returned ${seaJs.statusCode}`);
    else if (seaJs.body.length < 100) fail('GET /node_modules/gun/sea.js returned suspiciously little content');
    else console.log(`[smoke-mobile] GET /node_modules/gun/sea.js -> ${seaJs.statusCode} OK`);
  } catch (err) {
    fail(`request error: ${err.message}`);
  }

  try { child.kill('SIGTERM'); } catch { /* ignore */ }

  if (process.exitCode) {
    console.error('[smoke-mobile] one or more assertions failed');
  } else {
    console.log('[smoke-mobile] PASS: bundled mobile embedded-node boots once and serves everything the on-device layout needs');
  }
}

main().catch((err) => {
  console.error('[smoke-mobile] fatal error:', err);
  process.exitCode = 1;
});
