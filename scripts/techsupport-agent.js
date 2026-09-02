const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const DIST_TECHSUPPORT_MODULE = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');

// Mirror dev-techsupport-login.js's dev TLS detection; TECHSUPPORT_APP_URL overrides it
// entirely for pointing this agent at a real deployment instead of a local dev server.
const devKeyPath = process.env.TLS_KEY_PATH || path.resolve(ROOT, 'certs/dev-key.pem');
const devCertPath = process.env.TLS_CERT_PATH || path.resolve(ROOT, 'certs/dev-cert.pem');
const devTlsEnabled =
  process.env.DISABLE_HMR !== 'true' && fs.existsSync(devKeyPath) && fs.existsSync(devCertPath);
const DEFAULT_APP_URL = `${devTlsEnabled ? 'https' : 'http'}://localhost:${process.env.PORT || 3001}`;
const APP_URL = process.env.TECHSUPPORT_APP_URL || DEFAULT_APP_URL;
const SERVER_WAIT_MS = 60_000;
const POLL_INTERVAL_MS = Number(process.env.TECHSUPPORT_AGENT_POLL_MS || 5000);

/**
 * Minimal headless TechSupport agent (docs/TODO.md "Priority 5 — TechSupport productionization":
 * "Package the headless/off-server TechSupport agent").
 *
 * Reuses the exact same tested browser-side code path a human operator exercises today by
 * running `npm run dev:techsupport` and clicking "Publish" in the Support Inbox panel: this
 * script drives a headless Chromium instance authenticated with the canonical TechSupport DM key
 * (same disk → Node → browser localStorage injection channel as dev-techsupport-login.js), polls
 * `techsupport-inbox/*` in-page, and offers pending questions to a human operator over stdin. An
 * answer is delivered by emitting the same 'answerSupportQuestion' UI event the Support Inbox
 * panel's "Publish" button emits (ui-manager.ts), so it runs through the identical, already-
 * tested `handleAnswerSupportQuestion` in app.ts — no support-answering logic is duplicated here.
 *
 * This is deliberately NOT a fully unattended agent: a human still reads and types every answer
 * (auto-answering of previously-answered questions already happens independently, client-side,
 * from each asker's own cached FAQ bundle — see techsupport-faq.ts). What this process buys is
 * *presence*: the TechSupport identity, greeting, and FAQ bundle stay live and verifiable without
 * a developer's visible browser tab open, so it's meant to run as a standing process (pm2,
 * systemd, a container, etc.) pointed at a real deployment via TECHSUPPORT_APP_URL.
 *
 * Key custody is still a deployment decision this script does not make for you: which machine
 * holds TECHSUPPORT_SEA_PAIR_JSON, and whether it is replicated across redundant operator
 * machines (the design note's "K3-4: server, laptops, dedicated machine") is unscoped ops work —
 * see docs/TODO.md.
 */
function requireCompiledTechSupport() {
  try {
    return require(DIST_TECHSUPPORT_MODULE);
  } catch (err) {
    console.log('[techsupport-agent] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return require(DIST_TECHSUPPORT_MODULE);
  }
}

function loadPair(techsupport) {
  let pair;
  const keyFilePath = process.env.TECHSUPPORT_KEY_FILE;
  if (keyFilePath) {
    pair = JSON.parse(fs.readFileSync(keyFilePath, 'utf8'));
  } else if (process.env.TECHSUPPORT_SEA_PAIR_JSON) {
    pair = JSON.parse(process.env.TECHSUPPORT_SEA_PAIR_JSON);
  } else {
    throw new Error(
      'Set TECHSUPPORT_SEA_PAIR_JSON (see .env.local) or TECHSUPPORT_KEY_FILE (path to the key file) ' +
      'before running the TechSupport agent.',
    );
  }
  if (!pair || !pair.pub || !pair.priv || !pair.epub || !pair.epriv) {
    throw new Error('TechSupport key is missing pub/epub/priv/epriv.');
  }
  const expectedPub = techsupport.currentTechSupportDmPub();
  if (pair.pub !== expectedPub) {
    throw new Error(
      `TechSupport key's pub (${pair.pub}) does not match currentTechSupportDmPub() ` +
      `(${expectedPub}) — refusing to start. This would be silent impersonation.`,
    );
  }
  return pair;
}

function waitForServer(url, timeoutMs) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function retry() {
      if (Date.now() >= deadline) reject(new Error(`Server not ready after ${timeoutMs}ms (${url})`));
      else setTimeout(poll, 500);
    }
    function poll() {
      const req = client.get(url, { rejectUnauthorized: false }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.setTimeout(5000, () => req.destroy(new Error('probe timeout')));
    }
    poll();
  });
}

async function waitForTechSupportIdentity(page, expectedUserId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ready = await page.evaluate((userId) => {
      const app = window.__iinpublic_app && window.__iinpublic_app.getApp && window.__iinpublic_app.getApp();
      return !!(app && app.currentUser && app.currentUser.id === userId);
    }, expectedUserId);
    if (ready) return;
    if (Date.now() >= deadline) throw new Error('TechSupport identity did not resolve in time');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/**
 * Reads `techsupport-inbox/*` directly from the page's own Gun instance — the same source
 * app.ts's `subscribeToSupportInboxIfTechSupport` feeds the Support Inbox panel from. `.map()`
 * has no "done" signal, so this waits a bounded window (matching the 700ms/1500ms budgets
 * app.ts's own techsupport-inbox reads already use) and returns whatever arrived.
 */
async function listPendingSupportQuestions(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const app = window.__iinpublic_app.getApp();
        const gun = app.gunService.getGun();
        const entries = new Map();
        gun
          .get('techsupport-inbox')
          .map()
          .once((data, questionKey) => {
            if (!questionKey || questionKey.startsWith('_')) return;
            if (data && typeof data === 'object' && data.status === 'pending') {
              entries.set(questionKey, { ...data, questionKey });
            }
          });
        setTimeout(() => resolve(Array.from(entries.values())), 1500);
      }),
  );
}

/** Triggers the same 'answerSupportQuestion' event the Support Inbox panel's Publish button emits. */
async function answerSupportQuestion(page, input) {
  await page.evaluate((answerInput) => {
    window.__iinpublic_app.getApp().uiManager.emit('answerSupportQuestion', answerInput);
  }, input);
}

function promptLine(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function runAgentLoop(page) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Fast-path only: handleAnswerSupportQuestion already flips the Gun entry to 'answered', so
  // the next poll excludes it too. This just avoids re-prompting on the poll immediately after.
  const answeredThisSession = new Set();
  console.log(`👂 Watching the TechSupport inbox every ${POLL_INTERVAL_MS}ms — Ctrl+C to stop.`);
  for (;;) {
    const pending = (await listPendingSupportQuestions(page)).filter(
      (entry) => !answeredThisSession.has(entry.questionKey),
    );
    for (const entry of pending) {
      console.log(`\n— New question from ${entry.askedBy} —`);
      console.log(entry.question);
      const answer = (await promptLine(rl, 'Answer (blank to skip for now): ')).trim();
      if (!answer) continue;
      await answerSupportQuestion(page, {
        questionKey: entry.questionKey,
        question: entry.question,
        answer,
        conversationId: entry.conversationId,
        askedBy: entry.askedBy,
      });
      answeredThisSession.add(entry.questionKey);
      console.log('✅ Answered and published.');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

(async () => {
  const techsupport = requireCompiledTechSupport();
  const pair = loadPair(techsupport);

  console.log(`⏳ Waiting for server at ${APP_URL}...`);
  await waitForServer(APP_URL, SERVER_WAIT_MS);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });

  process.once('SIGINT', async () => { await browser.close(); process.exit(130); });
  process.once('SIGTERM', async () => { await browser.close(); process.exit(143); });

  // Injected before every navigation in this context (including stage-zero's internal
  // self-reload), so the app's very first boot sees the canonical id + pair — never a randomly
  // generated one. Same channel dev-techsupport-login.js uses; the private key never touches the
  // web bundle or the relay.
  await context.addInitScript(
    ({ userId, keypairStorageKey, pairJson }) => {
      window.localStorage.setItem('iinpublic_user_id', userId);
      window.localStorage.setItem(keypairStorageKey, pairJson);
    },
    {
      userId: techsupport.TECHSUPPORT_ROOT_USER_ID,
      keypairStorageKey: 'iinpublic_techsupport_keypair_v1',
      pairJson: JSON.stringify(pair),
    },
  );

  const page = await context.newPage();
  page.on('pageerror', (err) => console.log(`[techsupport-agent] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[techsupport-agent] console.error: ${msg.text()}`);
  });

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`⏳ Waiting for TechSupport identity to boot (pub=${pair.pub.slice(0, 12)}…)...`);
  await waitForTechSupportIdentity(page, techsupport.TECHSUPPORT_ROOT_USER_ID, SERVER_WAIT_MS);
  console.log('✅ TechSupport agent online.');

  await runAgentLoop(page);
})().catch((err) => {
  console.error('❌ techsupport-agent error:', err.message);
  process.exit(1);
});
