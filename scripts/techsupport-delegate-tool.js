#!/usr/bin/env node
'use strict';

/**
 * OPEN-27 local root-control tool.
 *
 * The encrypted TechSupport pair is decrypted only in this short-lived Node process. The tool
 * signs a public delegate credential locally and sends only that credential to the keyless relay;
 * it never starts a browser or writes the pair to Web Storage.
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

function usage() {
  return `TechSupport local delegate control

Usage:
  npm run techsupport:delegate -- issue \\
    --api-base https://www.iinpublic.com \\
    --delegate-user-id <user-id> --delegate-pub <verified-pub> \\
    --label "Support phone" [--ttl-days 30] [--dry-run]

  npm run techsupport:delegate -- revoke \\
    --api-base https://www.iinpublic.com \\
    --delegate-pub <pub> [--dry-run]

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

function compiledModules() {
  try {
    return {
      delegates: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-delegate.js')),
      techsupport: require(path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js')),
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

function clearPrivateFields(pair) {
  if (!pair || typeof pair !== 'object') return;
  pair.priv = '';
  pair.epriv = '';
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(argv);
  const [command] = options._;
  if (!command || command === 'help') {
    console.log(usage());
    return;
  }
  if (command !== 'issue' && command !== 'revoke') throw new Error(`Unknown command.\n\n${usage()}`);

  const apiBase = normalizeApiBase(options['api-base'] || process.env.TECHSUPPORT_API_BASE);
  const modules = dependencies.modules || compiledModules();
  const pair = dependencies.pair || loadEncryptedOperatorPair(options);
  try {
    modules.techsupport.assertTechSupportDmPair(pair);
    const request = dependencies.requestJson || requestJson;
    const grant = command === 'issue'
      ? await issue(options, pair, modules.delegates, apiBase, request)
      : await revoke(options, pair, modules.delegates, apiBase, request);
    console.log(`${options.dryRun ? 'Signed (not published)' : 'Published'} ${command} credential.`);
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
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  clearPrivateFields,
  issue,
  loadEncryptedOperatorPair,
  main,
  normalizeApiBase,
  parseOptions,
  parseTtlDays,
  publishGrant,
  revoke,
};
