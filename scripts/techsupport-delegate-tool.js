#!/usr/bin/env node
'use strict';

/**
 * OPEN-27 local root-control tool.
 *
 * The encrypted TechSupport pair is decrypted only in this short-lived Node process. The tool
 * signs a public delegate credential locally and sends only that credential to the keyless relay;
 * it never starts a browser or writes the pair to Web Storage.
 *
 * `invite`/`approve` (added 2026-09-24) are the CLI counterpart of the in-app invite-code flow
 * (support-delegates-view.ts's "Invite delegate" dialog / support-delegate-optin-view.ts's "enter
 * invite code" form) — the actual production-intended way for an ordinary browser/app user to
 * become a delegate, with NO console snippet and NO manually copy-pasted raw public key. That
 * in-app flow's "generate invite" half only ever worked from a `dev:techsupport`-mode root
 * browser session, which production deliberately can't have (OPEN-27) — these two commands close
 * that gap without ever touching a browser: `invite` generates the same code format the existing
 * "enter invite code" field already accepts, and `approve` reviews + signs the resulting request
 * once the candidate has entered it, exactly like the master's in-app "pending requests" panel.
 */

const path = require('path');
const {
  fingerprint,
  inspectVaultFileSync,
  loadTechSupportPairSync,
} = require('../src/server/security/techsupport-key-custody');

const ROOT = path.join(__dirname, '..');
const DEFAULT_TTL_DAYS = 30;
const MAX_TTL_DAYS = 90;
const REQUEST_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 3_000;

function usage() {
  return `TechSupport local delegate control

Usage:
  npm run techsupport:delegate -- invite \\
    --api-base https://www.iinpublic.com \\
    [--poll-timeout-seconds 300] [--dry-run]

    Generates a short-lived invite code (same format the app's own "enter invite
    code" field accepts — Settings, before a candidate has a grant) and prints it
    for you to hand to the candidate over any channel you trust (read it aloud,
    text it, etc.). Then polls the relay for the resulting signed request. Never
    signs or publishes anything on its own — prints the exact 'approve' command to
    run once a request arrives, so you can review who's asking before trusting them.
    --dry-run prints the code without polling.

  npm run techsupport:delegate -- approve \\
    --api-base https://www.iinpublic.com \\
    --request-id <id-from-invite> --label "Support phone" [--ttl-days 30] [--dry-run]

    Re-fetches and re-verifies the specific pending request by id, then signs and
    publishes an ordinary delegate grant for its candidate — the only step here
    that touches the master key.

  npm run techsupport:delegate -- issue \\
    --api-base https://www.iinpublic.com \\
    --delegate-user-id <user-id> --delegate-pub <verified-pub> \\
    --label "Support phone" [--ttl-days 30] [--dry-run]

    Direct issue when you already have the candidate's own pub/userId through some
    other verified channel. Prefer 'invite'/'approve' when the candidate can act on
    their own device — it never requires them to hand you a raw key by hand.

  npm run techsupport:delegate -- revoke \\
    --api-base https://www.iinpublic.com \\
    --delegate-pub <pub> [--dry-run]

  npm run techsupport:delegate -- migrate-faq \\
    --api-base https://www.iinpublic.com [--dry-run]

    One-time (docs/TODO.md OPEN-31): the FAQ used to be ONE signed bundle. Fetches that legacy
    bundle, verifies it against the current delegate roster, and re-signs each of its answers
    as its own per-entry record with the master key, so answers that only ever existed in the
    old bundle stay auto-answerable. Idempotent — re-running just re-publishes the same
    records. --dry-run prints what would be signed without publishing.

The encrypted vault is read from TECHSUPPORT_KEY_FILE (or --key) and its passphrase from
TECHSUPPORT_KEY_PASSPHRASE_FILE. Verify the delegate public-key fingerprint over an independent
channel before issuing a grant. HTTP is accepted only for loopback development URLs.`;
}

function parseOptions(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      options._.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name === 'dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Option --${name} requires a value.`);
    options[name] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, name) {
  const value = String(options[name] || '').trim();
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function boundedText(options, name, maxLength) {
  const value = requireOption(options, name);
  if (value.length > maxLength) throw new Error(`Option --${name} exceeds ${maxLength} characters.`);
  return value;
}

function normalizeApiBase(input) {
  let parsed;
  try {
    parsed = new URL(String(input || ''));
  } catch {
    throw new Error('--api-base must be an absolute HTTPS URL (HTTP is loopback-only).');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('--api-base must not contain credentials, a query, or a fragment.');
  }
  const loopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
    throw new Error('--api-base must use HTTPS unless it targets loopback development.');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function parseTtlDays(value) {
  if (value === undefined) return DEFAULT_TTL_DAYS;
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_TTL_DAYS) {
    throw new Error(`--ttl-days must be an integer from 1 through ${MAX_TTL_DAYS}.`);
  }
  return days;
}

function parsePollTimeoutSeconds(value, defaultSeconds) {
  if (value === undefined) return defaultSeconds;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error('--poll-timeout-seconds must be a positive integer.');
  }
  return seconds;
}

function randomSecretHex() {
  // Matches the browser's own randomSecretHex() (app.ts) byte count — not required for
  // correctness (verification is symmetric regardless of length), just for consistency.
  return require('crypto').randomBytes(18).toString('hex');
}

function compiledModules() {
  try {
    return {
      delegates: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-delegate.js')),
      techsupport: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js')),
      invite: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-delegate-invite.js')),
      faqBundle: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-faq-bundle.js')),
      faqEntry: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-faq-entry.js')),
    };
  } catch {
    throw new Error('Compiled server modules are missing. Run `npm run build:server` first.');
  }
}

function loadEncryptedOperatorPair(options, env = process.env) {
  const keyFile = String(options.key || env.TECHSUPPORT_KEY_FILE || '').trim();
  if (!keyFile) {
    throw new Error(
      'The delegate tool requires an encrypted vault via --key or TECHSUPPORT_KEY_FILE; ' +
      'legacy TECHSUPPORT_SEA_PAIR_JSON is refused.',
    );
  }
  // `inspectVaultFileSync` accepts only the versioned encrypted envelope. Run it before the
  // general loader, which intentionally retains plaintext-file support for one-time migration.
  inspectVaultFileSync(keyFile);
  return loadTechSupportPairSync({ keyFile, env });
}

async function requestJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* handled by status below */ }
    if (!response.ok) {
      const reason = body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new Error(`Relay request failed: ${reason}`);
    }
    return body;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Relay request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** GET a possibly-404 resource without throwing — 404 just means "not there yet" while polling. */
async function requestJsonOrNull(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* fall through */ }
    if (!response.ok) return null;
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function publishGrant(apiBase, grant, request = requestJson) {
  return request(`${apiBase}/api/support/delegate-grants`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(grant),
  });
}

async function issue(options, pair, delegates, apiBase, request = requestJson) {
  const delegateUserId = boundedText(options, 'delegate-user-id', 256);
  const delegatePub = boundedText(options, 'delegate-pub', 2048);
  const label = boundedText(options, 'label', 120);
  const ttlDays = parseTtlDays(options['ttl-days']);
  const grant = await delegates.signDelegateGrant({
    delegatePub,
    delegateUserId,
    label,
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  }, pair);
  if (!options.dryRun) await publishGrant(apiBase, grant, request);
  return grant;
}

async function revoke(options, pair, delegates, apiBase, request = requestJson) {
  const delegatePub = boundedText(options, 'delegate-pub', 2048);
  const response = await request(`${apiBase}/api/support/delegate-grants`);
  const rawGrants = Array.isArray(response.grants) ? response.grants : [];
  const raw = rawGrants.find((grant) => grant && grant.delegatePub === delegatePub);
  const existing = await delegates.verifyDelegateGrant(raw);
  if (!existing) throw new Error('No verifiable delegate grant exists for that public key.');
  if (existing.revokedAt) throw new Error('That delegate grant is already revoked.');
  const grant = await delegates.signDelegateGrant({
    delegatePub: existing.delegatePub,
    delegateUserId: existing.delegateUserId,
    label: existing.label,
    issuedAt: existing.issuedAt,
    expiresAt: existing.expiresAt,
    revokedAt: new Date().toISOString(),
  }, pair);
  if (!options.dryRun) await publishGrant(apiBase, grant, request);
  return grant;
}

/**
 * Generates and prints an invite code, then (unless --dry-run) polls the relay for the resulting
 * signed request. Deliberately never signs or publishes anything itself — a candidate obtaining
 * the code is not the same as the operator trusting them, so this only ever hands back the
 * verified candidate details plus the exact 'approve' command to run.
 */
async function invite(options, inviteModule, apiBase, request = requestJsonOrNull) {
  const payload = inviteModule.createDelegateInvite(randomSecretHex);
  const code = inviteModule.encodeDelegateInviteCode(payload);
  const result = { payload, code, matched: null };

  console.log('Invite code (enter this in Settings → "Become a support delegate"):');
  console.log(code);
  console.log(`Expires: ${new Date(payload.expiresAt).toISOString()}`);

  if (options.dryRun) return result;

  const defaultTimeoutSeconds = Math.max(1, Math.round((payload.expiresAt - Date.now()) / 1000));
  const timeoutSeconds = parsePollTimeoutSeconds(options['poll-timeout-seconds'], defaultTimeoutSeconds);
  console.log(`Waiting up to ${timeoutSeconds}s for the candidate to enter it...`);

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const raw = await request(`${apiBase}/api/support/delegate-requests/${encodeURIComponent(payload.requestId)}`);
    if (raw) {
      const verified = await inviteModule.verifyDelegateRequest(raw);
      if (verified && await inviteModule.delegateRequestMatchesInvite(verified, payload)) {
        result.matched = verified;
        console.log('\nA matching, signature-verified request arrived:');
        console.log(`  candidateUserId: ${verified.candidateUserId}`);
        console.log(`  candidatePub fingerprint: ${fingerprint(verified.candidatePub)}`);
        console.log(`  requestedAt: ${verified.requestedAt}`);
        console.log('\nVerify that fingerprint against the candidate over an independent channel, then run:');
        console.log(
          `  npm run techsupport:delegate -- approve --api-base ${apiBase} ` +
          `--request-id ${payload.requestId} --label "<label>" [--ttl-days ${DEFAULT_TTL_DAYS}]`,
        );
        return result;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  console.log('\nNo matching request arrived before the code expired. Run `invite` again for a fresh code.');
  return result;
}

async function approve(options, pair, delegates, inviteModule, apiBase, request = requestJson) {
  const requestId = boundedText(options, 'request-id', 256);
  const label = boundedText(options, 'label', 120);
  const ttlDays = parseTtlDays(options['ttl-days']);
  const raw = await request(`${apiBase}/api/support/delegate-requests/${encodeURIComponent(requestId)}`);
  const verified = await inviteModule.verifyDelegateRequest(raw);
  if (!verified) throw new Error('No verifiable pending request exists for that request id (it may have expired or was never received).');
  const grant = await delegates.signDelegateGrant({
    delegatePub: verified.candidatePub,
    delegateUserId: verified.candidateUserId,
    label,
    expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString(),
  }, pair);
  if (!options.dryRun) await publishGrant(apiBase, grant, request);
  return grant;
}

/**
 * OPEN-31 one-time migration: legacy whole-bundle FAQ -> per-entry records. The bundle is verified
 * (author must be the master or a currently-valid delegate) BEFORE anything is signed, because
 * re-signing as the master vouches for the text — a relay-tampered bundle must never become a
 * master-signed answer.
 */
async function migrateFaq(options, pair, modules, apiBase, request = requestJson) {
  const fetched = await request(`${apiBase}/api/support/faq-bundle`);
  if (!fetched || !fetched.bundle) {
    console.log('No legacy FAQ bundle on the relay — nothing to migrate.');
    return [];
  }
  const rawBundle = fetched.bundle;
  const bundle = typeof rawBundle.entriesJson === 'string'
    ? { ...rawBundle, entries: JSON.parse(rawBundle.entriesJson) }
    : rawBundle;
  delete bundle.entriesJson;
  const grantsBody = await request(`${apiBase}/api/support/delegate-grants`);
  const grants = Array.isArray(grantsBody.grants) ? grantsBody.grants : [];
  const verified = await modules.faqBundle.verifyFaqBundle(bundle, {
    fetchGrant: async (delegatePub) => grants.find((grant) => grant.delegatePub === delegatePub) || null,
  });
  if (!verified) throw new Error('The legacy FAQ bundle failed verification — refusing to re-sign it.');
  const signedEntries = [];
  for (const entry of verified.entries) {
    const signed = await modules.faqEntry.signFaqEntry(entry, pair);
    signedEntries.push(signed);
    console.log(`${options.dryRun ? 'Would publish' : 'Publishing'}: ${entry.questionKey}  ${JSON.stringify(entry.canonicalQuestion)}`);
    if (!options.dryRun) {
      await request(`${apiBase}/api/support/faq-entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });
    }
  }
  console.log(`${options.dryRun ? 'Signed (not published)' : 'Published'} ${signedEntries.length} FAQ entr${signedEntries.length === 1 ? 'y' : 'ies'}.`);
  return signedEntries;
}

function clearPrivateFields(pair) {
  if (!pair || typeof pair !== 'object') return;
  pair.priv = '';
  pair.epriv = '';
}

const COMMANDS_NEEDING_MASTER_KEY = new Set(['issue', 'revoke', 'approve', 'migrate-faq']);

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(argv);
  const [command] = options._;
  if (!command || command === 'help') {
    console.log(usage());
    return;
  }
  const knownCommands = new Set(['issue', 'revoke', 'invite', 'approve', 'migrate-faq']);
  if (!knownCommands.has(command)) throw new Error(`Unknown command.\n\n${usage()}`);

  const apiBase = normalizeApiBase(options['api-base'] || process.env.TECHSUPPORT_API_BASE);
  const modules = dependencies.modules || compiledModules();

  if (command === 'invite') {
    const request = dependencies.requestJsonOrNull || requestJsonOrNull;
    await invite(options, modules.invite, apiBase, request);
    return;
  }

  // issue/revoke/approve all sign with the master key — load and clear it as tightly as possible.
  const pair = dependencies.pair || loadEncryptedOperatorPair(options);
  try {
    modules.techsupport.assertTechSupportDmPair(pair);
    const request = dependencies.requestJson || requestJson;
    if (command === 'migrate-faq') {
      return await migrateFaq(options, pair, modules, apiBase, request);
    }
    const grant = command === 'issue'
      ? await issue(options, pair, modules.delegates, apiBase, request)
      : command === 'approve'
        ? await approve(options, pair, modules.delegates, modules.invite, apiBase, request)
        : await revoke(options, pair, modules.delegates, apiBase, request);
    console.log(`${options.dryRun ? 'Signed (not published)' : 'Published'} ${command === 'approve' ? 'issue' : command} credential.`);
    console.log(`Delegate pub fingerprint: ${fingerprint(grant.delegatePub)}`);
    console.log(`Master pub fingerprint: ${fingerprint(grant.masterPub)}`);
    console.log(`Expires: ${grant.expiresAt}`);
    console.log(`Revoked: ${grant.revokedAt || 'no'}`);
    if (options.dryRun) console.log(JSON.stringify(grant, null, 2));
    return grant;
  } finally {
    clearPrivateFields(pair);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[techsupport-delegate] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  COMMANDS_NEEDING_MASTER_KEY,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  approve,
  clearPrivateFields,
  invite,
  issue,
  loadEncryptedOperatorPair,
  main,
  migrateFaq,
  normalizeApiBase,
  parseOptions,
  parsePollTimeoutSeconds,
  parseTtlDays,
  publishGrant,
  randomSecretHex,
  requestJsonOrNull,
  revoke,
};
