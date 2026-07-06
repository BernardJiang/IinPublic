#!/usr/bin/env node
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const {
  TECHSUPPORT_ROOT_USER_ID,
  ensureTechSupportBootstrap,
} = require('./dev-techsupport-bootstrap');

const ROOT = path.resolve(__dirname, '..');
const webPort = Number.parseInt(process.env.DEV_MULTI_SMOKE_WEB_PORT || '3001', 10);
const gunPort = Number.parseInt(
  process.env.DEV_MULTI_SMOKE_GUN_PORT || String(webPort - 3001 + 8080),
  10,
);
const userCount = Math.max(1, Number.parseInt(process.env.DEV_MULTI_USERS || '3', 10) || 3);
const expectedGlobal = userCount + 1; // TechSupport bootstrap + intended browser users.
const profileRoot = path.join(ROOT, 'user_data', 'dev-multi-smoke');
const appUrl = `http://127.0.0.1:${webPort}`;
const apiBase = `http://127.0.0.1:${gunPort}`;
const headless = process.env.DEV_MULTI_SMOKE_HEADED !== '1';
const verbose = process.env.DEV_MULTI_SMOKE_VERBOSE === '1';
const children = [];
const contexts = [];

function killListenersOnPort(port) {
  try {
    const pids = execFileSync('lsof', ['-ti', `tcp:${port}`], { encoding: 'utf8' })
      .split(/\s+/)
      .filter(Boolean);
    if (pids.length) execFileSync('kill', ['-9', ...pids], { stdio: 'ignore' });
  } catch {
    /* no listener */
  }
}

function spawnChild(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.on('data', (chunk) => {
    if (verbose) process.stdout.write(`[${label}] ${chunk}`);
  });
  child.stderr.on('data', (chunk) => {
    if (verbose) process.stderr.write(`[${label}] ${chunk}`);
  });
  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] exited with code ${code}`);
    } else if (signal) {
      console.error(`[${label}] exited via ${signal}`);
    }
  });
  return child;
}

function waitForHttp(url, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() >= deadline) reject(new Error(`${url} was not ready after ${timeoutMs}ms`));
      else setTimeout(poll, 500);
    };
    poll();
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Cache-Control': 'no-cache', ...(options?.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function waitForGlobalMembers(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  let nextLogAt = 0;
  while (Date.now() < deadline) {
    last = await fetchJson(`${apiBase}/api/chatrooms/global/members`).catch(() => []);
    const ids = last.map((member) => String(member.userId || '')).filter(Boolean);
    if (Date.now() >= nextLogAt) {
      const labels = last.map((member) => `${member.stageName || '?'}:${member.userId || '?'}`);
      console.log(`[dev:multi:smoke] Global now ${ids.length}/${expectedGlobal}: ${labels.join(', ') || '(empty)'}`);
      nextLogAt = Date.now() + 5_000;
    }
    if (ids.length === expectedGlobal && ids.includes(TECHSUPPORT_ROOT_USER_ID)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Global did not settle at ${expectedGlobal} members; last=${JSON.stringify(last)}`,
  );
}

async function closeAll() {
  await Promise.allSettled(contexts.map((context) => context.close()));
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const child of children) {
    if (!child.killed) child.kill('SIGKILL');
  }
}

async function main() {
  if (!Number.isFinite(webPort) || !Number.isFinite(gunPort)) {
    throw new Error('DEV_MULTI_SMOKE_WEB_PORT / DEV_MULTI_SMOKE_GUN_PORT must be numeric');
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'server', 'server', 'index.js'))) {
    throw new Error('dist/server/server/index.js is missing. Run npm run build:server first.');
  }

  console.log(`[dev:multi:smoke] web=${webPort} gun=${gunPort} users=${userCount}`);
  killListenersOnPort(webPort);
  killListenersOnPort(gunPort);
  fs.rmSync(profileRoot, { recursive: true, force: true });
  fs.mkdirSync(profileRoot, { recursive: true });

  spawnChild('gun', process.execPath, ['dist/server/server/index.js'], {
    PORT: String(gunPort),
    E2E_GUN_MEMORY_ONLY: '1',
    DEV_GUN_FRESH: '1',
    CHATROOM_MAX_CAPACITY: '50',
    CHATROOM_ENABLE_FIFO: 'false',
  });
  await waitForHttp(`${apiBase}/health`);
  await ensureTechSupportBootstrap(apiBase, { preferSnapshotImport: true });
  console.log('[dev:multi:smoke] TechSupport bootstrap seeded');

  spawnChild('web', 'npm', ['run', 'dev:web:e2e', '--', '--port', String(webPort)], {
    PORT: String(webPort),
    DISABLE_HMR: 'true',
    IINPUBLIC_STAGE_SEED: 'stage-zero',
    IINPUBLIC_STAGE_ZERO_MAX_GLOBAL: String(expectedGlobal),
    DEV_GUN_FRESH: '1',
    CHATROOM_MAX_CAPACITY: '50',
    CHATROOM_ENABLE_FIFO: 'false',
  });
  await waitForHttp(appUrl);

  for (let i = 0; i < userCount; i++) {
    const context = await chromium.launchPersistentContext(
      path.join(profileRoot, `user_${i + 1}`),
      {
        headless,
        viewport: { width: 620, height: 900 },
        args: [
          `--window-position=${i * 640},0`,
          '--window-size=620,900',
          '--force-device-scale-factor=1',
        ],
      },
    );
    contexts.push(context);
    const page = context.pages()[0] || await context.newPage();
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!window.__iinpublic_app?.getApp?.()?.currentUser?.id,
      { timeout: 30_000 },
    );
  }

  const members = await waitForGlobalMembers();
  console.log(`[dev:multi:smoke] Global members OK: ${members.map((m) => m.stageName || m.userId).join(', ')}`);
}

main()
  .then(async () => {
    await closeAll();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('[dev:multi:smoke] failed:', error.message);
    await closeAll();
    process.exit(1);
  });
