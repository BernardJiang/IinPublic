#!/usr/bin/env node
/**
 * Post-build smoke test for the embedded-mobile bundle (build-embedded-mobile.js).
 *
 * Regression coverage for a real bug found live 2026-09-23 against a real Huawei phone: esbuild's
 * CJS bundling of `gun/sea` silently broke its default-export interop (`import_sea.default.verify
 * is not a function`), so EVERY signature verification inside the bundle — delegate grants,
 * recovery anchors, the FAQ bundle — failed unconditionally on every native (Android/desktop)
 * build, with no error surfaced anywhere a developer would see it: the HTTP routes all still
 * returned 200 with empty results, indistinguishable from "nothing published yet". Plain
 * `techsupport-delegate.test.ts` unit tests never caught this because they import the TypeScript
 * source directly, never the actual bundled artifact — the bug was specific to the bundling step
 * itself. This script closes that gap by booting the JUST-BUILT bundle as a real child process
 * and running a real signed grant through its actual HTTP route, end to end.
 *
 * Needs a real TechSupport signing pair (the same one `tests/e2e/**` specs use) to produce a
 * grant the compiled trust anchor will actually accept — skips (not fails) when unavailable,
 * matching those specs' own `test.skip(!REAL_PAIR, ...)` convention. Wired into
 * `build-embedded-mobile.js`'s own npm script so it runs on every rebuild a dev machine with
 * `.env.local` configured performs — exactly the moment that matters, right before staging an
 * Android/desktop build for real use.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const bundlePath = path.join(repoRoot, 'dist', 'embedded-mobile', 'server', 'node-app', 'embedded-node.js');

function loadRealPair() {
  const envLocalPath = path.join(repoRoot, '.env.local');
  if (!fs.existsSync(envLocalPath)) return null;
  const content = fs.readFileSync(envLocalPath, 'utf8');
  const match = content.match(/^TECHSUPPORT_SEA_PAIR_JSON=(.*)$/m);
  if (!match) return null;
  // .env.local wraps the value in single quotes (TECHSUPPORT_SEA_PAIR_JSON='{"pub":...}') —
  // strip a matching pair before parsing, same as `set -a; . ./.env.local` would via the shell.
  let raw = match[1].trim();
  if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1);
  else if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function waitForHealth(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Embedded bundle did not become healthy on port ${port} within ${timeoutMs}ms`);
}

async function main() {
  if (!fs.existsSync(bundlePath)) {
    console.error(`[verify-embedded-mobile-bundle] FAIL: bundle not found at ${bundlePath} — run build-embedded-mobile.js first.`);
    process.exitCode = 1;
    return;
  }

  const pair = loadRealPair();
  if (!pair) {
    console.log('[verify-embedded-mobile-bundle] SKIP: no TECHSUPPORT_SEA_PAIR_JSON in .env.local — cannot sign a trust-anchor-accepted grant to exercise this bundle end to end.');
    return;
  }

  const { signDelegateGrant } = require(path.join(repoRoot, 'dist', 'server', 'shared', 'techsupport-delegate.js'));
  const testDelegatePub = `smoke-test-delegate-pub-${Date.now()}`;
  const grant = await signDelegateGrant({
    delegatePub: testDelegatePub,
    delegateUserId: 'smoke-test-delegate-user-id',
    label: 'build-verification smoke test',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }, pair);

  const port = 18999;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-embedded-bundle-smoke-'));
  const child = spawn(process.execPath, [bundlePath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      IINPUBLIC_LOCAL_PORT: String(port),
      IINPUBLIC_USER_DATA_DIR: dataDir,
      IINPUBLIC_DATA_DIR: dataDir,
      IINPUBLIC_LAN_DISCOVERY_ENABLED: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => { childOutput += chunk; });
  child.stderr.on('data', (chunk) => { childOutput += chunk; });

  try {
    await waitForHealth(port, 10_000);

    const posted = await fetch(`http://127.0.0.1:${port}/api/support/delegate-grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(grant),
    });
    const postedBody = await posted.json();
    if (!posted.ok || postedBody.stored !== true) {
      throw new Error(`POST /api/support/delegate-grants did not report stored:true — status=${posted.status} body=${JSON.stringify(postedBody)}`);
    }

    const fetched = await fetch(`http://127.0.0.1:${port}/api/support/delegate-grants`);
    const fetchedBody = await fetched.json();
    const found = (fetchedBody.grants || []).find((g) => g.delegatePub === testDelegatePub);
    if (!found) {
      throw new Error(
        `A grant signed by the real trust-anchor pub was posted successfully but never verified back — ` +
        `this is exactly the 2026-09-23 regression (SEA.verify broken inside the bundle). ` +
        `GET returned: ${JSON.stringify(fetchedBody)}`,
      );
    }

    console.log('[verify-embedded-mobile-bundle] PASS: a real signed delegate grant round-tripped through the bundled server correctly.');
  } catch (err) {
    console.error('[verify-embedded-mobile-bundle] FAIL:', err.message);
    console.error('--- bundle process output ---');
    console.error(childOutput);
    process.exitCode = 1;
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[verify-embedded-mobile-bundle] failed:', err);
  process.exitCode = 1;
});
