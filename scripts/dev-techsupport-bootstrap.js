const http = require('http');
const https = require('https');
const path = require('path');
const { execFileSync } = require('child_process');

// The dev server serves https on 8080 when certs/dev-*.pem exist (self-signed),
// so requests must pick the right client and skip cert verification.
function clientFor(url) {
  return String(url).startsWith('https') ? https : http;
}

const TECHSUPPORT_STAGE_NAME = 'TechSupport';
const TECHSUPPORT_ROOT_USER_ID = 'iinpublic-root-techsupport';
const TECHSUPPORT_NETWORK_ROLE = 'root-techsupport';
const TECHSUPPORT_HEADSHOT = 'TS';

const DIST_GRAPH_MODULE = path.join(__dirname, '..', 'dist', 'server', 'shared', 'techsupport-graph.js');

/**
 * The graph shape has one authored source: `src/shared/techsupport-graph.ts` (docs/TODO.md K1
 * item 5). This plain-Node script can't `import` TS directly, so it requires the compiled
 * `dist/shared` output, auto-building it on first use if missing/stale rather than keeping a
 * second hand-written copy that can drift from `tests/e2e/helpers/clear-database.ts`.
 */
function createTechSupportSnapshotGraph() {
  let mod;
  try {
    mod = require(DIST_GRAPH_MODULE);
  } catch (err) {
    console.log('[dev-techsupport-bootstrap] dist/shared/techsupport-graph.js missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    mod = require(DIST_GRAPH_MODULE);
  }
  return mod.techSupportBaselineGraph(new Date());
}

function waitForHttp(url, timeoutMs = 60_000) {
  const client = clientFor(url);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else retry();
      });
      req.on('error', retry);
      req.setTimeout(5_000, () => req.destroy(new Error('probe timeout')));
    };
    const retry = () => {
      if (Date.now() >= deadline) reject(new Error(`${url} was not ready after ${timeoutMs}ms`));
      else setTimeout(poll, 500);
    };
    poll();
  });
}

function postJson(url, body, timeoutMs = 4_000) {
  // Uses http/https directly (not fetch) so the self-signed dev cert is accepted.
  const client = clientFor(url);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = client.request(new URL(url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      rejectUnauthorized: false,
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
        if (ok || /already|reserved|exists/i.test(text)) resolve();
        else reject(new Error(`${url} failed: ${res.statusCode} ${text}`));
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    req.end(data);
  });
}

async function importTechSupportSnapshot(apiBase) {
  await postJson(`${apiBase}/api/test/import-snapshot`, {
    version: 1,
    gunGraph: createTechSupportSnapshotGraph(),
  }, 10_000);
}

async function seedViaPublicApis(apiBase) {
  await postJson(`${apiBase}/api/users`, {
    id: TECHSUPPORT_ROOT_USER_ID,
    stageName: TECHSUPPORT_STAGE_NAME,
    headshot: TECHSUPPORT_HEADSHOT,
    profile: [],
    languages: ['en'],
    interests: [],
    networkRole: TECHSUPPORT_NETWORK_ROLE,
    talkFilters: {
      allowedLanguages: ['en'],
      minDistanceMiles: 0,
      maxDistanceMiles: 50,
      requireGoodGrammar: true,
      blockDirtyWords: true,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
    },
  });
  await postJson(`${apiBase}/api/chatrooms/global/members`, {
    userId: TECHSUPPORT_ROOT_USER_ID,
    stageName: TECHSUPPORT_STAGE_NAME,
  });
}

async function ensureTechSupportBootstrap(apiBase, options = {}) {
  const trimmed = String(apiBase || '').replace(/\/+$/, '');
  if (!trimmed) throw new Error('apiBase is required for TechSupport bootstrap');
  await waitForHttp(`${trimmed}/health`);

  if (options.preferSnapshotImport) {
    await importTechSupportSnapshot(trimmed);
    return;
  }

  try {
    await seedViaPublicApis(trimmed);
  } catch (error) {
    if (!options.allowSnapshotImport) {
      throw error;
    }
    await importTechSupportSnapshot(trimmed);
  }
}

module.exports = {
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
  ensureTechSupportBootstrap,
  waitForHttp,
};
