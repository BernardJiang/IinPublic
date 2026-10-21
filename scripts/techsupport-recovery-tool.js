#!/usr/bin/env node
'use strict';

/**
 * OPEN-29: local tool for the independent TechSupport emergency recovery authority.
 *
 * The recovery key is a SEPARATE keypair from the day-to-day DM/announcement operator key
 * (docs/security/techsupport-and-user-production-security.md) — generated once, ahead of any
 * incident, and its private half moved to genuinely offline/cold storage (not left on the
 * operator's regular machine the way the DM vault is). Its only job is to sign a small
 * "revocation / next-anchor" record: "stop trusting these old TechSupport keys, and/or start
 * trusting these new ones" — something every already-installed client (including one that can't
 * immediately receive a new build) can verify on its own, because the recovery key's PUBLIC half
 * was compiled into that client ahead of time (`techsupport-trust-anchors.json`'s `recovery`
 * section). See `src/shared/techsupport-recovery.ts` for the record shape and verify/reconcile
 * logic this tool's `publish` command produces input for.
 *
 * Commands:
 *   generate --out secrets/techsupport-recovery.key.json
 *     One-time setup. Prints the public key + fingerprint to add to
 *     `techsupport-trust-anchors.json`'s `recovery.current`/`recovery.trusted` (a normal source
 *     change + rebuild, same as any other compiled trust anchor). After generating, move the
 *     vault + its passphrase off this machine to real offline/cold storage.
 *
 *   publish --api-base <url> --key <vault> --reason "<why>"
 *     [--revoke-dm <pub>]... [--revoke-announcement <pub>]...
 *     [--next-dm <pub>] [--next-announcement <pub>] [--dry-run]
 *     Signs and (unless --dry-run) publishes a recovery anchor record — run only during an
 *     actual incident, from wherever the offline recovery vault was moved to.
 *
 *   status --api-base <url>
 *     Read-only: fetches and prints the current recovery anchor and its full history. No key
 *     needed.
 *
 *   verify --key <vault>
 *     Offline: decrypts the vault and confirms it holds a pinned recovery key, then forgets it.
 *     Run it against the cold-storage copy BEFORE removing the copy on this machine, and again
 *     at each recovery drill.
 *
 *   custody-check
 *     Offline: lists recovery key material still on this machine (a recovery vault or its
 *     passphrase under secrets/, recovery settings in .env files). Exits 1 while any remain —
 *     the production-readiness gate for OPEN-29.
 *
 * The recovery vault's passphrase is read from TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE
 * (preferred) or TECHSUPPORT_RECOVERY_KEY_PASSPHRASE — deliberately DISTINCT env vars from the
 * DM vault's, so the two secrets are never accidentally interchangeable.
 */

const path = require('path');
const {
  assertPairShape,
  assertPrivateFilePermissions,
  fingerprint,
  inspectVaultFileSync,
  loadTechSupportPairSync,
  readPassphraseSync,
  sealPair,
  writeJsonAtomicSync,
} = require('../src/server/security/techsupport-key-custody');

const ROOT = path.join(__dirname, '..');
const fs = require('fs');
const KEY_FORMAT = 'iinpublic-techsupport-key-v1';
// Settings that put the recovery key (or what unlocks its vault) in a file this machine reads.
const RECOVERY_ENV_SETTINGS = [
  'TECHSUPPORT_RECOVERY_SEA_PAIR_JSON',
  'TECHSUPPORT_RECOVERY_KEY_PASSPHRASE',
  'TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE',
];
const ENV_FILES = ['.env', '.env.local', '.env.development.local', '.env.test.local', '.env.production.local'];
const DEFAULT_REASON_MAX_LENGTH = 500;
const REQUEST_TIMEOUT_MS = 10_000;

function usage() {
  return `TechSupport emergency recovery authority (OPEN-29)

Usage:
  npm run techsupport:recovery -- generate --out secrets/techsupport-recovery.key.json
  npm run techsupport:recovery -- publish --api-base https://www.iinpublic.com \\
    --key secrets/techsupport-recovery.key.json --reason "..." \\
    [--revoke-dm <pub>]... [--revoke-announcement <pub>]... \\
    [--next-dm <pub>] [--next-announcement <pub>] [--dry-run]
  npm run techsupport:recovery -- status --api-base https://www.iinpublic.com
  npm run techsupport:recovery -- verify --key /Volumes/<usb>/techsupport-recovery.key.json
  npm run techsupport:recovery -- custody-check

The recovery vault is read from --key and its passphrase from
TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE (preferred) or TECHSUPPORT_RECOVERY_KEY_PASSPHRASE —
kept deliberately separate from the day-to-day DM vault's own passphrase settings.`;
}

function parseOptions(argv) {
  const options = { _: [], revokeDm: [], revokeAnnouncement: [] };
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
    if (name === 'revoke-dm') options.revokeDm.push(value);
    else if (name === 'revoke-announcement') options.revokeAnnouncement.push(value);
    else options[name] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, name) {
  const value = String(options[name] || '').trim();
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function boundedText(value, name, maxLength) {
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

function readRecoveryPassphraseSync(env = process.env) {
  return readPassphraseSync({
    TECHSUPPORT_KEY_PASSPHRASE_FILE: env.TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE,
    TECHSUPPORT_KEY_PASSPHRASE: env.TECHSUPPORT_RECOVERY_KEY_PASSPHRASE,
  });
}

function compiledModules() {
  const { execFileSync } = require('child_process');
  const DIST_RECOVERY = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport-recovery.js');
  const DIST_TECHSUPPORT = path.join(ROOT, 'dist', 'server', 'shared', 'techsupport.js');
  try {
    return { recovery: require(DIST_RECOVERY), techsupport: require(DIST_TECHSUPPORT) };
  } catch {
    console.log('[techsupport-recovery] dist/server/shared missing — running `npm run build:server` once...');
    execFileSync('npm', ['run', 'build:server'], { stdio: 'inherit', cwd: ROOT });
    return { recovery: require(DIST_RECOVERY), techsupport: require(DIST_TECHSUPPORT) };
  }
}

async function generate(options) {
  const output = requireOption(options, 'out');
  const passphrase = readRecoveryPassphraseSync();
  const SEA = require('gun/sea');
  const pair = await SEA.pair();
  assertPairShape(pair);
  const resolved = writeJsonAtomicSync(output, sealPair(pair, passphrase, { role: 'recovery' }), {
    force: options.force,
  });
  console.log(`Encrypted TechSupport recovery vault written to ${resolved} (mode 600).`);
  console.log(`Public key: ${pair.pub}`);
  console.log(`SHA-256 fingerprint: ${fingerprint(pair.pub)}`);
  console.log('');
  console.log('Add this pub to techsupport-trust-anchors.json\'s "recovery" section, rebuild, and');
  console.log('ship it in a normal release BEFORE any incident. Then move this vault file and its');
  console.log('passphrase to genuinely offline/cold storage, separate from the DM operator vault.');
}

async function requestJson(url, requestOptions = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...requestOptions, signal: controller.signal });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* handled by status below */ }
    if (!response.ok) {
      const reason = body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
      throw new Error(`Relay request failed: ${reason}`);
    }
    return body;
  } catch (error) {
    if (error && error.name === 'AbortError') throw new Error(`Relay request timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function publish(options, pair, recovery, apiBase, request = requestJson) {
  const reason = boundedText(requireOption(options, 'reason'), 'reason', DEFAULT_REASON_MAX_LENGTH);
  const record = await recovery.signRecoveryAnchor(
    {
      revokedDmPubs: options.revokeDm,
      revokedAnnouncementPubs: options.revokeAnnouncement,
      nextDmPub: options['next-dm'] || null,
      nextAnnouncementPub: options['next-announcement'] || null,
      reason,
    },
    pair,
  );
  if (!options.dryRun) {
    await request(`${apiBase}/api/support/recovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
  }
  console.log(`${options.dryRun ? 'Signed (not published)' : 'Published'} recovery anchor record.`);
  console.log(`Recovery pub fingerprint: ${fingerprint(record.recoveryPub)}`);
  console.log(`Revoked DM pubs: ${record.revokedDmPubs.join(', ') || 'none'}`);
  console.log(`Revoked announcement pubs: ${record.revokedAnnouncementPubs.join(', ') || 'none'}`);
  console.log(`Next DM pub: ${record.nextDmPub || 'unchanged'}`);
  console.log(`Next announcement pub: ${record.nextAnnouncementPub || 'unchanged'}`);
  console.log(`Reason: ${record.reason}`);
  if (options.dryRun) console.log(JSON.stringify(record, null, 2));
  return record;
}

async function status(options, apiBase, request = requestJson) {
  const body = await request(`${apiBase}/api/support/recovery`);
  console.log(JSON.stringify(body, null, 2));
  return body;
}

function assertTrustedRecoveryPub(pair, techsupport) {
  const expectedPub = techsupport.currentTechSupportRecoveryPub();
  if (pair.pub !== expectedPub && !techsupport.isTrustedTechSupportRecoveryPub(pair.pub)) {
    throw new Error(
      `Loaded recovery key (${pair.pub}) is not a trusted recovery anchor ` +
      `(expected ${expectedPub} or another entry in recovery.trusted) — refusing to sign with it.`,
    );
  }
}

function verify(pair, keyFile) {
  console.log(`OK: ${keyFile} decrypts to the pinned recovery key.`);
  console.log(`Public key: ${pair.pub}`);
  console.log(`SHA-256 fingerprint: ${fingerprint(pair.pub)}`);
  return { pub: pair.pub, fingerprint: fingerprint(pair.pub) };
}

/** Recovery key material under `root` — file paths and setting names only, never values. */
function findLocalRecoveryMaterial(root = ROOT) {
  const findings = [];
  const secretsDir = path.join(root, 'secrets');
  const names = fs.existsSync(secretsDir) ? fs.readdirSync(secretsDir).sort() : [];
  for (const name of names) {
    const file = path.join('secrets', name);
    if (name.endsWith('.json')) {
      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { /* not a vault */ }
      if (parsed && parsed.format === KEY_FORMAT && parsed.role === 'recovery') {
        findings.push({ location: file, kind: 'encrypted recovery vault' });
      }
    } else if (/recovery/i.test(name)) {
      findings.push({ location: file, kind: 'recovery file (likely the vault passphrase)' });
    }
  }
  for (const name of ENV_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const setting of RECOVERY_ENV_SETTINGS) {
      const assigned = new RegExp(`^\\s*(?:export\\s+)?${setting}\\s*=\\s*\\S`);
      if (lines.some((line) => assigned.test(line))) {
        findings.push({ location: `${name}: ${setting}`, kind: setting.endsWith('SEA_PAIR_JSON') ? 'plaintext recovery key' : 'recovery passphrase setting' });
      }
    }
  }
  return findings;
}

function custodyCheck(root = ROOT) {
  const findings = findLocalRecoveryMaterial(root);
  if (findings.length === 0) {
    console.log('No recovery key material found in this checkout.');
    return findings;
  }
  console.log('Recovery key material is still in this checkout:');
  for (const finding of findings) console.log(`  ${finding.location} — ${finding.kind}`);
  console.log('');
  console.log('Copy the vault and its passphrase to offline storage, check that copy with');
  console.log('`verify --key <copy>`, then remove the entries above and run custody-check again.');
  process.exitCode = 1;
  return findings;
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
  if (command === 'generate') return generate(options);
  if (command === 'custody-check') return custodyCheck(dependencies.root);
  if (command === 'verify') return withTrustedPair(options, dependencies, (pair, keyFile) => verify(pair, keyFile));
  if (command !== 'publish' && command !== 'status') throw new Error(`Unknown command.\n\n${usage()}`);

  const apiBase = normalizeApiBase(options['api-base'] || process.env.TECHSUPPORT_API_BASE);
  const request = dependencies.requestJson || requestJson;
  if (command === 'status') return status(options, apiBase, request);

  return withTrustedPair(options, dependencies, (pair, _keyFile, modules) =>
    publish(options, pair, modules.recovery, apiBase, request));
}

/** Loads the recovery vault named by --key, refuses an untrusted key, and wipes it afterwards. */
async function withTrustedPair(options, dependencies, use) {
  const modules = dependencies.modules || compiledModules();
  const keyFile = requireOption(options, 'key');
  inspectVaultFileSync(keyFile); // refuse a legacy plaintext file early, same discipline as OPEN-27's delegate tool
  const pair = dependencies.pair || loadTechSupportPairSync({ keyFile, passphrase: readRecoveryPassphraseSync() });
  try {
    assertTrustedRecoveryPub(pair, modules.techsupport);
    return await use(pair, keyFile, modules);
  } finally {
    clearPrivateFields(pair);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[techsupport-recovery] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  clearPrivateFields,
  custodyCheck,
  findLocalRecoveryMaterial,
  generate,
  main,
  normalizeApiBase,
  parseOptions,
  publish,
  readRecoveryPassphraseSync,
  status,
  verify,
};
