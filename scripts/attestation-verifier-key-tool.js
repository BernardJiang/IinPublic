#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const {
  assertPairShape,
  assertPrivateFilePermissions,
  fingerprint,
  generateVerifierKeyPair,
  inspectVaultFileSync,
  loadVerifierPairSync,
  readPassphraseSync,
  sealPair,
  signWithVerifierKey,
  verifyWithVerifierKey,
  writeJsonAtomicSync,
} = require('../src/server/security/attestation-verifier-key-custody');

// Rotation tooling (trust-anchor publish/prepare/activate/retire, mirroring
// scripts/techsupport-key-tool.js's `rotation` subcommands) is deliberately not built yet — there
// is nothing published for a rotation to roll over until Part C's verifier route exists and has
// issued at least one credential. Add it alongside GET /api/attestation/verifier-keys once that's
// real; docs/security/attestation-verifier-key-custody-and-rotation.md tracks this as a TODO.

function usage() {
  return `Attestation verifier key custody

Usage:
  npm run attestation:key -- generate --out secrets/attestation-verifier.key.json
  npm run attestation:key -- import --from path/to/plain-pair.json --out secrets/attestation-verifier.key.json
  npm run attestation:key -- inspect --key secrets/attestation-verifier.key.json
  npm run attestation:key -- verify --key secrets/attestation-verifier.key.json

Passphrases are accepted only through ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE (preferred) or
ATTESTATION_VERIFIER_KEY_PASSPHRASE. Use --force only to replace a backed-up output vault.`;
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

function printPublicKey(label, publicKeyPem) {
  console.log(`${label}:\n${publicKeyPem}`);
  console.log(`SHA-256 fingerprint (verifierKeyId): ${fingerprint(publicKeyPem)}`);
}

function verifyPair(pair) {
  assertPairShape(pair);
  const challenge = `iinpublic-attestation-verifier-key-check:${Date.now()}:${Math.random()}`;
  const signature = signWithVerifierKey(pair.privateKeyPem, challenge);
  if (!verifyWithVerifierKey(pair.publicKeyPem, challenge, signature)) {
    throw new Error('Attestation verifier key failed its signing self-check.');
  }
  return pair;
}

function generate(options) {
  const output = requireOption(options, 'out');
  const passphrase = readPassphraseSync();
  const pair = verifyPair(generateVerifierKeyPair());
  const resolved = writeJsonAtomicSync(output, sealPair(pair, passphrase), { force: options.force });
  console.log(`Encrypted attestation verifier vault written to ${resolved} (mode 600).`);
  printPublicKey('Public key', pair.publicKeyPem);
}

function importKey(options) {
  const output = requireOption(options, 'out');
  const input = path.resolve(requireOption(options, 'from'));
  assertPrivateFilePermissions(input);
  const pair = verifyPair(assertPairShape(JSON.parse(fs.readFileSync(input, 'utf8'))));
  const resolved = writeJsonAtomicSync(output, sealPair(pair, readPassphraseSync()), {
    force: options.force,
  });
  console.log(`Imported key into encrypted attestation verifier vault ${resolved} (mode 600).`);
  printPublicKey('Public key', pair.publicKeyPem);
}

function inspect(options) {
  const metadata = inspectVaultFileSync(requireOption(options, 'key'));
  console.log(`Format: ${metadata.format}`);
  console.log(`Role: ${metadata.role}`);
  console.log(`Created: ${metadata.createdAt}`);
  printPublicKey('Public key', metadata.publicKeyPem);
}

function verify(options) {
  const keyFile = requireOption(options, 'key');
  const pair = verifyPair(loadVerifierPairSync({ keyFile }));
  console.log('Vault decrypted and signing self-check passed.');
  printPublicKey('Public key', pair.publicKeyPem);
}

function main(argv = process.argv.slice(2)) {
  const options = parseOptions(argv);
  const [command] = options._;
  if (!command || command === 'help' || command === '--help') {
    console.log(usage());
    return;
  }
  if (command === 'generate') return generate(options);
  if (command === 'import') return importKey(options);
  if (command === 'inspect') return inspect(options);
  if (command === 'verify') return verify(options);
  throw new Error(`Unknown command.\n\n${usage()}`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[attestation-verifier-key] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseOptions, verifyPair };
