#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SEA = require('gun/sea');
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
const {
  activateRotation,
  assertTrustAnchorConfig,
  prepareRotation,
  retireRotation,
} = require('./lib/techsupport-key-rotation');

const ROOT = path.join(__dirname, '..');
const TRUST_ANCHORS_PATH = path.join(ROOT, 'src', 'shared', 'techsupport-trust-anchors.json');
const SIGNED_ARTIFACTS = [
  'techsupport-identity.signed.json',
  'techsupport-greeting.signed.json',
  'techsupport-support-ack.signed.json',
  'techsupport-onboarding-tips.signed.json',
].map((name) => path.join(ROOT, 'src', 'shared', name));
const SIGNING_SCRIPTS = [
  'sign-techsupport-identity.js',
  'sign-techsupport-greeting.js',
  'sign-techsupport-support-ack.js',
  'sign-techsupport-onboarding-tips.js',
];

function usage() {
  return `TechSupport key custody and rotation

Usage:
  npm run techsupport:key -- generate --out secrets/techsupport-master.key.json
  npm run techsupport:key -- import --from path/to/plain-pair.json --out secrets/techsupport-master.key.json
  npm run techsupport:key -- inspect --key secrets/techsupport-master.key.json
  npm run techsupport:key -- verify --key secrets/techsupport-master.key.json
  npm run techsupport:key -- rotation status
  npm run techsupport:key -- rotation prepare --key secrets/new-techsupport.key.json
  npm run techsupport:key -- rotation activate --key secrets/new-techsupport.key.json
  npm run techsupport:key -- rotation retire --pub <old-public-key> --confirm <old-public-key>

Passphrases are accepted only through TECHSUPPORT_KEY_PASSPHRASE_FILE (preferred) or
TECHSUPPORT_KEY_PASSPHRASE. Use --force only to replace a backed-up output vault.`;
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
    if (name === 'force') {
      options.force = true;
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
  if (!options[name]) throw new Error(`Missing required option --${name}.`);
  return options[name];
}

function readTrustAnchors() {
  return assertTrustAnchorConfig(JSON.parse(fs.readFileSync(TRUST_ANCHORS_PATH, 'utf8')));
}

function writeTrustAnchors(config) {
  writeJsonAtomicSync(TRUST_ANCHORS_PATH, config, {
    force: true,
    mode: 0o644,
    directoryMode: 0o755,
  });
}

function printPublicKey(label, pub) {
  console.log(`${label}: ${pub}`);
  console.log(`SHA-256 fingerprint: ${fingerprint(pub)}`);
}

async function verifyPair(pair) {
  assertPairShape(pair);
  const challenge = `iinpublic-techsupport-key-check:${Date.now()}:${Math.random()}`;
  const signature = await SEA.sign(challenge, pair);
  const verified = await SEA.verify(signature, pair.pub);
  if (verified !== challenge) throw new Error('TechSupport key failed its signing self-check.');
  return pair;
}

async function generate(options) {
  const output = requireOption(options, 'out');
  const passphrase = readPassphraseSync();
  const pair = await SEA.pair();
  await verifyPair(pair);
  const resolved = writeJsonAtomicSync(output, sealPair(pair, passphrase), { force: options.force });
  console.log(`Encrypted TechSupport vault written to ${resolved} (mode 600).`);
  printPublicKey('Public key', pair.pub);
}

async function importKey(options) {
  const output = requireOption(options, 'out');
  let pair;
  if (options.from) {
    const input = path.resolve(options.from);
    assertPrivateFilePermissions(input);
    pair = assertPairShape(JSON.parse(fs.readFileSync(input, 'utf8')));
  } else {
    pair = loadTechSupportPairSync({ env: { ...process.env, TECHSUPPORT_KEY_FILE: '' } });
  }
  await verifyPair(pair);
  const resolved = writeJsonAtomicSync(output, sealPair(pair, readPassphraseSync()), {
    force: options.force,
  });
  console.log(`Imported key into encrypted TechSupport vault ${resolved} (mode 600).`);
  printPublicKey('Public key', pair.pub);
}

function inspect(options) {
  const metadata = inspectVaultFileSync(requireOption(options, 'key'));
  console.log(`Format: ${metadata.format}`);
  console.log(`Role: ${metadata.role}`);
  console.log(`Created: ${metadata.createdAt}`);
  printPublicKey('Public key', metadata.pub);
}

async function verify(options) {
  const keyFile = requireOption(options, 'key');
  const pair = await verifyPair(loadTechSupportPairSync({ keyFile }));
  console.log('Vault decrypted and signing self-check passed.');
  printPublicKey('Public key', pair.pub);
}

function rotationStatus() {
  const config = readTrustAnchors();
  for (const role of ['dm', 'announcement']) {
    console.log(`${role}: current=${config[role].current}`);
    config[role].trusted.forEach((pub, index) => {
      console.log(`  trusted[${index}]=${pub} (${fingerprint(pub)})`);
    });
  }
}

async function rotationPrepare(options) {
  const keyFile = requireOption(options, 'key');
  const pair = await verifyPair(loadTechSupportPairSync({ keyFile }));
  const current = readTrustAnchors();
  if (current.dm.current === pair.pub && current.announcement.current === pair.pub) {
    throw new Error('That TechSupport key is already current.');
  }
  writeTrustAnchors(prepareRotation(current, pair.pub));
  console.log('Prepared overlap release. Deploy this trust-anchor change before activation.');
  printPublicKey('Prepared public key', pair.pub);
}

function snapshotFiles(paths) {
  return new Map(paths.map((filePath) => [filePath, fs.readFileSync(filePath)]));
}

function restoreFiles(snapshot) {
  for (const [filePath, contents] of snapshot) fs.writeFileSync(filePath, contents);
}

async function rotationActivate(options) {
  const keyFile = path.resolve(requireOption(options, 'key'));
  const pair = await verifyPair(loadTechSupportPairSync({ keyFile }));
  const current = readTrustAnchors();
  const next = activateRotation(current, pair.pub);
  const snapshot = snapshotFiles([TRUST_ANCHORS_PATH, ...SIGNED_ARTIFACTS]);
  try {
    writeTrustAnchors(next);
    execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'inherit' });
    const env = { ...process.env, TECHSUPPORT_KEY_FILE: keyFile };
    delete env.TECHSUPPORT_SEA_PAIR_JSON;
    for (const script of SIGNING_SCRIPTS) {
      execFileSync(process.execPath, [path.join(__dirname, script)], { cwd: ROOT, env, stdio: 'inherit' });
    }
  } catch (error) {
    restoreFiles(snapshot);
    try { execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'ignore' }); } catch (_) { /* best effort */ }
    throw new Error(`Activation failed and tracked files were restored: ${error.message}`);
  }
  console.log('Activated the new TechSupport key and re-signed all committed artifacts.');
  console.log('Deploy this release; retain the old key in the overlap list until the rollout window closes.');
  printPublicKey('Current public key', pair.pub);
}

function rotationRetire(options) {
  const pub = requireOption(options, 'pub');
  if (options.confirm !== pub) {
    throw new Error('Retirement requires --confirm with the exact public key being removed.');
  }
  writeTrustAnchors(retireRotation(readTrustAnchors(), pub));
  console.log('Retired the old TechSupport trust anchor. Deploy this only after the rollout window closes.');
  printPublicKey('Retired public key', pub);
}

async function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const [command, subcommand] = options._;
  if (!command || command === 'help' || command === '--help') {
    console.log(usage());
    return;
  }
  if (command === 'generate') return generate(options);
  if (command === 'import') return importKey(options);
  if (command === 'inspect') return inspect(options);
  if (command === 'verify') return verify(options);
  if (command === 'rotation' && subcommand === 'status') return rotationStatus();
  if (command === 'rotation' && subcommand === 'prepare') return rotationPrepare(options);
  if (command === 'rotation' && subcommand === 'activate') return rotationActivate(options);
  if (command === 'rotation' && subcommand === 'retire') return rotationRetire(options);
  throw new Error(`Unknown command.\n\n${usage()}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[techsupport-key] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main, parseOptions, verifyPair };
