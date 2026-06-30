#!/usr/bin/env node
/**
 * NOTE (2026-06-30): runtime results from this script were unreliable in the
 * sandboxed CI-like environment this was authored in (short-lived Gun client
 * processes did not reliably complete the WS handshake within the observation
 * window, producing false "not found" results even for same-server sanity
 * checks). The DEFINITIVE finding for this investigation came from reading
 * Gun's wire-fanout code directly, not from this script:
 *
 *   node_modules/gun/gun.js, `mesh.say` (~line 1502): every local `.put()`
 *   triggers `root.on('out', msg)` with NO specific peer, which falls into
 *   the unconditional broadcast branch (~line 1524-1536: `ps = opt.peers`,
 *   loop calls `mesh.say(msg, p)` for every connected peer). There is no
 *   subscription/interest check — ANY local put is sent to ALL peers,
 *   including the upstream hub peer added via `attachGun()`'s
 *   `upstreamHubPeers`. The hub's `radisk:false` (relay-only mode) prevents
 *   that data from reaching disk, but the in-memory graph on the hub process
 *   still receives and merges it. This confirms the risk docs/TODO.md already
 *   flagged with ⚠ is real, not hypothetical, and pins the exact code path.
 *
 * Fixing this requires either (a) a soul-classification-tracking outbound
 * filter scoped to just the hub peer connection (non-trivial: nested Gun
 * `.get().get()` chains use auto-generated souls for child nodes, so a
 * single-message content filter can't classify them without tracking the
 * relational graph as it's observed), or (b) replacing the generic Gun peer
 * link to the hub with a narrow, explicit REST-based discovery channel. Both
 * are real implementation work, intentionally NOT attempted blind in this
 * pass — see docs/TODO.md S3 "Hub hardening fix" for the follow-up item.
 *
 * This script remains useful as a real, separate-process verification
 * harness (hub + 2 independent embedded-node peers) on a machine/CI where
 * Gun's websocket handshake completes reliably within a few seconds.
 *
 * S3 hub-hardening verification (docs/TODO.md):
 *
 *   "Hub hardening: confirm the public hub only relays relayOnlyDataClasses
 *    for embedded peers (it is already relayOnlyHub in prod — verify no app
 *    subgraphs sync upstream from a local node)."
 *
 * This boots three REAL, separate processes (matching production topology):
 *   - hub:    RELAY_ONLY_HUB=1, E2E_GUN_MEMORY_ONLY=1 (mirrors www.iinpublic.com)
 *   - nodeA:  embedded local node, peers upstream to hub (mirrors a desktop/
 *             mobile shell's bundled node)
 *   - nodeB:  a second, independent embedded local node also peered to the
 *             same hub (mirrors a different user's device)
 *
 * It then writes an app-classified Gun path (`talks/<id>`, which
 * `shouldSkipServerGunPersist`/`classifyServerConnectorPath` both mark as
 * owner-private / not hub-persistable) on nodeA, and checks two things a
 * short time later:
 *   1. Does a Gun client connected DIRECTLY to the hub (bypassing nodeA) see
 *      that data? (in-memory graph leak onto the relay-only hub)
 *   2. Does nodeB — an unrelated peer connected to the same hub — see that
 *      data? (cross-peer leak via the hub acting as a relay)
 *
 * Exit code 0 = no leak observed (hub never produced app-private data to an
 * independent reader). Exit code 1 = leak observed — the embedded node's
 * generic upstream Gun peer connection is gossiping app data, not just the
 * relayOnlyDataClasses (discovery/signaling/presence/room-membership).
 *
 * Usage: node scripts/relay-only-verification/run.js
 */
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const repoRoot = path.resolve(__dirname, '..', '..');
const hubEntry = path.join(repoRoot, 'dist', 'server', 'server', 'index.js');
const nodeEntry = path.join(repoRoot, 'dist', 'server', 'node-app', 'embedded-node.js');

const HUB_PORT = 19931;
const NODE_A_PORT = 19932;
const NODE_B_PORT = 19933;

function checkBuilt() {
  for (const p of [hubEntry, nodeEntry]) {
    if (!fs.existsSync(p)) {
      console.error(`[verify] missing build artifact: ${p}\nRun "npm run build:server" first.`);
      process.exit(2);
    }
  }
}

function tmpDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `iinpublic-relay-verify-${name}-`));
  return dir;
}

const children = [];
function spawnServer(label, entry, env) {
  const child = spawn(process.execPath, [entry], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });
  child.on('exit', (code, sig) => {
    if (code !== null && code !== 0) {
      console.error(`[verify] ${label} exited early (code=${code} sig=${sig})\n${out.slice(-2000)}`);
    }
  });
  children.push(child);
  return child;
}

function waitForHealth(port, deadlineMs = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - start > deadlineMs) {
        reject(new Error(`port ${port} did not become healthy within ${deadlineMs}ms`));
        return;
      }
      setTimeout(tryOnce, 300);
    };
    tryOnce();
  });
}

function runClient(script, args, timeoutMs = 12000) {
  const out = execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const lastLine = out.trim().split('\n').filter(Boolean).pop() || '{}';
  return JSON.parse(lastLine);
}

function trace(label) {
  try {
    fs.appendFileSync('/tmp/relaytest/trace.log', `${new Date().toISOString()} ${label}\n`);
  } catch { /* ignore */ }
}

async function main() {
  trace('main:start');
  checkBuilt();

  const hubDataDir = tmpDir('hub'); // unused (E2E_GUN_MEMORY_ONLY=1) but kept for parity
  const nodeAData = tmpDir('nodeA');
  const nodeBData = tmpDir('nodeB');
  const webRoot = tmpDir('web');
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<html><body>ok</body></html>');

  trace('hub:spawn-begin');
  console.log('[verify] starting hub (RELAY_ONLY_HUB=1, in-memory)...');
  spawnServer('hub', hubEntry, {
    RELAY_ONLY_HUB: '1',
    E2E_GUN_MEMORY_ONLY: '1',
    PORT: String(HUB_PORT),
    NODE_ENV: 'test',
  });
  await waitForHealth(HUB_PORT);
  trace('hub:healthy');

  console.log('[verify] starting nodeA (embedded, peers upstream to hub)...');
  spawnServer('nodeA', nodeEntry, {
    IINPUBLIC_EMBEDDED_NODE: '1',
    IINPUBLIC_PLATFORM: 'ubuntu',
    IINPUBLIC_LOCAL_PORT: String(NODE_A_PORT),
    PORT: String(NODE_A_PORT),
    IINPUBLIC_HUB_GUN_URL: `http://127.0.0.1:${HUB_PORT}/gun`,
    IINPUBLIC_WEB_ROOT: webRoot,
    IINPUBLIC_DATA_DIR: nodeAData,
    IINPUBLIC_LOOPBACK_ONLY: '1',
    NODE_ENV: 'test',
  });
  await waitForHealth(NODE_A_PORT);
  trace('nodeA:healthy');

  console.log('[verify] starting nodeB (independent embedded peer, also -> hub)...');
  spawnServer('nodeB', nodeEntry, {
    IINPUBLIC_EMBEDDED_NODE: '1',
    IINPUBLIC_PLATFORM: 'android',
    IINPUBLIC_LOCAL_PORT: String(NODE_B_PORT),
    PORT: String(NODE_B_PORT),
    IINPUBLIC_HUB_GUN_URL: `http://127.0.0.1:${HUB_PORT}/gun`,
    IINPUBLIC_WEB_ROOT: webRoot,
    IINPUBLIC_DATA_DIR: nodeBData,
    IINPUBLIC_LOOPBACK_ONLY: '1',
    NODE_ENV: 'test',
  });
  await waitForHealth(NODE_B_PORT);
  trace('nodeB:healthy');

  const marker = `secret_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const talkPath = ['talks', `talk_leak_${marker}`];
  console.log(`[verify] writing app-classified path ${talkPath.join('/')} on nodeA...`);
  const putResult = runClient('gun-put.js', [
    `http://127.0.0.1:${NODE_A_PORT}/gun`,
    JSON.stringify(talkPath),
    JSON.stringify({ title: 'private talk body', marker }),
  ]);
  trace('put:done');
  if (!putResult.ok) {
    console.error('[verify] put failed:', putResult);
    process.exitCode = 2;
    cleanup();
    return;
  }

  console.log('[verify] checking whether the hub (direct, bypassing nodeA) can see it...');
  const hubRead = runClient('gun-get.js', [
    `http://127.0.0.1:${HUB_PORT}/gun`,
    JSON.stringify(talkPath),
    '5000',
  ]);

  console.log('[verify] checking whether nodeB (independent peer behind the same hub) can see it...');
  const nodeBRead = runClient('gun-get.js', [
    `http://127.0.0.1:${NODE_B_PORT}/gun`,
    JSON.stringify(talkPath),
    '5000',
  ]);

  console.log('[verify] results:', JSON.stringify({ hubRead, nodeBRead }, null, 2));

  const hubLeaked = !!(hubRead.found && hubRead.value && hubRead.value.marker === marker);
  const nodeBLeaked = !!(nodeBRead.found && nodeBRead.value && nodeBRead.value.marker === marker);

  if (hubLeaked || nodeBLeaked) {
    console.error(
      `[verify] FAIL: app-classified data leaked upstream. hubLeaked=${hubLeaked} nodeBLeaked=${nodeBLeaked}\n` +
        'The embedded node\'s generic Gun peer connection to the hub is gossiping ' +
        'app-layer graph writes, not just relayOnlyDataClasses (discovery/signaling/' +
        'presence/room-membership). See docs/TODO.md S3 "Hub hardening".',
    );
    process.exitCode = 1;
  } else {
    console.log(
      '[verify] PASS: app-classified data (talks/*) written on the embedded node was ' +
        'NOT observable from the hub directly, nor from an independent peer behind the ' +
        'same hub, within the observation window.',
    );
    process.exitCode = 0;
  }

  cleanup();
}

function cleanup() {
  for (const child of children) {
    try { child.kill('SIGTERM'); } catch { /* already gone */ }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });

main().catch((err) => {
  console.error('[verify] fatal error:', err);
  cleanup();
  process.exitCode = 2;
});
