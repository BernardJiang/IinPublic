#!/usr/bin/env node
/**
 * S3 embedded-node CI smoke test.
 *
 * "CI: add a headless smoke job that boots embedded-node.js and asserts
 * /health + / serve" (docs/TODO.md). This is the manual check that change
 * originally ran by hand; this script automates it so CI catches a broken
 * embedded-node boot (bad config resolution, missing dist/web, a server
 * route throwing on startup, etc.) before it reaches a native shell build.
 *
 * Boots dist/server/node-app/embedded-node.js exactly like a desktop/mobile
 * shell would (IINPUBLIC_EMBEDDED_NODE=1 + host-specific env), then asserts:
 *   1. GET /health returns 2xx.
 *   2. GET /  returns 2xx and serves the SPA's index.html (not a 404/500).
 *   3. The build-id stamp check ran without crashing the boot (a missing
 *      stamp is a warning, not fatal — see warnIfBuildIdsDrifted).
 *
 * Usage: node scripts/smoke-embedded-node.js
 * Exit code 0 = pass, non-zero = fail (prints the failing assertion + the
 * tail of the server's own stdout/stderr for debugging).
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..');
const nodeEntry = path.join(repoRoot, 'dist', 'server', 'node-app', 'embedded-node.js');
const webRoot = path.join(repoRoot, 'dist', 'web');
const PORT = parseInt(process.env.SMOKE_PORT || '18099', 10);

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
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
    fail(`missing build artifact: ${nodeEntry} — run "npm run build:embedded" first`);
    return;
  }
  if (!fs.existsSync(webRoot)) {
    fail(`missing build artifact: ${webRoot} — run "npm run build:web" first`);
    return;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-embedded-smoke-'));

  const child = spawn(process.execPath, [nodeEntry], {
    env: {
      ...process.env,
      IINPUBLIC_EMBEDDED_NODE: '1',
      IINPUBLIC_PLATFORM: 'ubuntu',
      IINPUBLIC_LOCAL_PORT: String(PORT),
      PORT: String(PORT),
      IINPUBLIC_WEB_ROOT: webRoot,
      IINPUBLIC_DATA_DIR: dataDir,
      IINPUBLIC_LOOPBACK_ONLY: '1',
      // No hub peer configured: this smoke test only needs the local node to
      // boot and serve; discovery connectivity is out of scope here.
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
    if (!health.statusCode || health.statusCode >= 300) {
      fail(`GET /health returned ${health.statusCode}`);
    } else {
      console.log(`[smoke] GET /health -> ${health.statusCode} OK`);
    }

    const root = await httpGet('/');
    if (!root.statusCode || root.statusCode >= 300) {
      fail(`GET / returned ${root.statusCode}`);
    } else if (!/<html/i.test(root.body)) {
      fail('GET / did not return HTML (SPA index.html not served)');
    } else {
      console.log(`[smoke] GET / -> ${root.statusCode} OK (serves SPA)`);
    }
  } catch (err) {
    fail(`request error: ${err.message}`);
  }

  try { child.kill('SIGTERM'); } catch { /* ignore */ }

  if (process.exitCode) {
    console.error('[smoke] one or more assertions failed');
  } else {
    console.log('[smoke] PASS: embedded-node boots and serves /health + / correctly');
  }
}

main().catch((err) => {
  console.error('[smoke] fatal error:', err);
  process.exitCode = 1;
});
