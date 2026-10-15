#!/usr/bin/env node
// Starts one phone-like embedded node for the phone-path E2E suite (tests/e2e/phone-path/):
// the same dist/server/node-app/embedded-node.js the Android app boots, in the production
// default hub mode (explicit-http relay, no raw Gun peer link), with no global WebCrypto
// (scripts/e2e-phone-runtime.cjs), a fresh data dir, and the hub pointed at a local test hub.
//
// Usage: node scripts/e2e-phone-node.mjs <localPort> <hubPort>
// PHONE_NODE_DATA_DIR=<dir> keeps the node's data in <dir> and leaves it on exit, so a journey can
// stop the node and start it again on the same data, like an app restart on a phone.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [localPort, hubPort] = process.argv.slice(2);
if (!localPort || !hubPort) {
  console.error('usage: node scripts/e2e-phone-node.mjs <localPort> <hubPort>');
  process.exit(2);
}

const keptDataDir = process.env.PHONE_NODE_DATA_DIR || '';
if (keptDataDir) fs.mkdirSync(keptDataDir, { recursive: true });
const dataDir = keptDataDir || fs.mkdtempSync(path.join(os.tmpdir(), `iinpublic-phone-${localPort}-`));
const env = { ...process.env };
// These isolate the worker hub's own Gun; on an embedded node they would also zero its hub link.
delete env.E2E_GUN_MEMORY_ONLY;
delete env.DEV_GUN_FRESH;
delete env.NODE_ENV;
delete env.E2E_HUB_API_DELAY_MS;
delete env.PHONE_NODE_DATA_DIR;
// Release capacity (498), as on a real phone: the production web bundle ignores test overrides.
delete env.CHATROOM_MAX_CAPACITY;
delete env.CHATROOM_ENABLE_FIFO;

const child = spawn(
  process.execPath,
  ['--require', path.join(repoRoot, 'scripts', 'e2e-phone-runtime.cjs'), path.join(repoRoot, 'dist', 'server', 'node-app', 'embedded-node.js')],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...env,
      TLS_DISABLE: '1',
      IINPUBLIC_EMBEDDED_NODE: '1',
      IINPUBLIC_PLATFORM: 'android',
      IINPUBLIC_LOCAL_PORT: String(localPort),
      PORT: String(localPort),
      IINPUBLIC_HUB_GUN_URL: `http://127.0.0.1:${hubPort}/gun`,
      IINPUBLIC_EMBEDDED_HUB_MODE: 'explicit-http',
      IINPUBLIC_WEB_ROOT: path.join(repoRoot, 'dist', 'web'),
      IINPUBLIC_DATA_DIR: dataDir,
      // The node chdirs into its data dir; point it at the repo's Gun browser assets, as the
      // desktop shell does (platforms/desktop/main.js).
      IINPUBLIC_NODE_MODULES_ROOT: path.join(repoRoot, 'node_modules'),
      IINPUBLIC_LOOPBACK_ONLY: '1',
      // No mDNS LAN discovery: otherwise phone A and phone B sync with each other directly (not
      // only through the hub, which is the route under test), and any real phone running the app
      // on this Wi-Fi feeds its Gun data in — a test Place from a release smoke showed up on a
      // fresh node with a dead hub (2026-10-14). PHONE_NODE_LAN_DISCOVERY=1 turns it back on.
      IINPUBLIC_LAN_DISCOVERY_ENABLED: process.env.PHONE_NODE_LAN_DISCOVERY === '1' ? '1' : '0',
    },
  },
);

const cleanup = () => {
  if (keptDataDir) return;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
child.on('exit', (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
