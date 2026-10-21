#!/usr/bin/env node
'use strict';

/**
 * Offline custody and rotation tool for the forward-authorized protocol-manifest chain.
 *
 * The historical genesis checkpoint trusted the TechSupport announcement key. Existing clients
 * cannot have that trust root replaced, so sequence 2 is a one-time bridge signed by that legacy
 * key. It commits K3, the first dedicated protocol-release key. Every later manifest N is signed
 * by KN and commits K(N+1). Private material is accepted only from encrypted, mode-600 vaults.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SEA = require('gun/sea');
const protocolCustody = require('../src/server/security/protocol-release-key-custody');
const techSupportCustody = require('../src/server/security/techsupport-key-custody');

const ROOT = path.join(__dirname, '..');
const DEFAULT_HISTORY_PATH = path.join(ROOT, 'src', 'shared', 'protocol-manifest-history.signed.json');

function usage() {
  return `Protocol manifest key custody and forward rotation

Usage:
  npm run protocol:manifest -- generate --sequence 3 \\
    --out secrets/protocol-release-k3.key.json \\
    --passphrase-out secrets/protocol-release-k3.passphrase

  npm run protocol:manifest -- append --expected-sequence 2 \\
    --signing-key secrets/techsupport-master.key.json \\
    --signing-passphrase-file secrets/techsupport-master.key.passphrase \\
    --next-key secrets/protocol-release-k3.key.json \\
    --effective-at 2026-10-12T00:00:00.000Z

  npm run protocol:manifest -- append --expected-sequence 3 \\
    --signing-key secrets/protocol-release-k3.key.json \\
    --signing-passphrase-file secrets/protocol-release-k3.passphrase \\
    --next-key secrets/protocol-release-k4.key.json \\
    --effective-at <ISO timestamp> [--capacity 498] [--protocol-epoch 1] \\
    [--extensions-file nearby-v3-attestor.json]

  npm run protocol:manifest -- inspect --key secrets/protocol-release-k3.key.json
  npm run protocol:manifest -- verify-key --key secrets/protocol-release-k3.key.json \\
    --passphrase-file secrets/protocol-release-k3.passphrase
  npm run protocol:manifest -- status
  npm run protocol:manifest -- verify-production

append defaults unchanged policy fields from the last manifest (or the compiled baseline for M2).
Use --required-capabilities/--optional-capabilities as comma-separated values, --minimum-engine,
--minimum-room-protocol, --legacy-allowed-until, and --retirement-mode only for reviewed changes.`;
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
  const value = String(options[name] || '').trim();
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function integerOption(options, name, fallback) {
  if (options[name] === undefined) return fallback;
  const value = Number(options[name]);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer.`);
  return value;
}

function listOption(options, name, fallback) {
  if (options[name] === undefined) return [...fallback];
  const value = String(options[name]).split(',').map((item) => item.trim()).filter(Boolean);
  if (new Set(value).size !== value.length) throw new Error(`--${name} contains duplicates.`);
  return value;
}

function ensureCompiled() {
  const protocolPath = path.join(ROOT, 'dist', 'server', 'shared', 'protocol-manifest.js');
  const productionPath = path.join(ROOT, 'dist', 'server', 'shared', 'production-protocol-manifest.js');
  const roomPath = path.join(ROOT, 'dist', 'server', 'shared', 'active-exchange-room.js');
  const portablePath = path.join(ROOT, 'dist', 'server', 'shared', 'portable-ecdsa.js');
  if (![protocolPath, productionPath, roomPath, portablePath].every(fs.existsSync)) {
    execFileSync('npm', ['run', 'build:server'], { cwd: ROOT, stdio: 'inherit' });
  }
  for (const modulePath of [protocolPath, productionPath, roomPath, portablePath]) {
    delete require.cache[require.resolve(modulePath)];
  }
  return {
    protocol: require(protocolPath),
    production: require(productionPath),
    room: require(roomPath),
    portable: require(portablePath),
  };
}

function historyPath(options) {
  return path.resolve(options.history || DEFAULT_HISTORY_PATH);
}

function readHistory(options) {
  const filePath = historyPath(options);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read protocol manifest history ${filePath}: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('Protocol manifest history must be a JSON array.');
  return parsed;
}

function clearPrivateFields(pair) {
  if (!pair || typeof pair !== 'object') return;
  pair.priv = '';
  pair.epriv = '';
}

async function verifyPair(pair, modules) {
  protocolCustody.assertPairShape(pair);
  const challenge = `iinpublic-protocol-release-key-check:${Date.now()}:${crypto.randomBytes(16).toString('hex')}`;
  const signature = await modules.portable.portableEcdsaSign(challenge, pair.priv);
  if (!await modules.portable.portableEcdsaVerify(signature, challenge, pair.pub)) {
    throw new Error('Protocol release key failed its signing self-check.');
  }
  return pair;
}

async function generate(options, dependencies = {}) {
  const sequence = integerOption(options, 'sequence');
  protocolCustody.assertSequence(sequence);
  const output = requireOption(options, 'out');
  const passphraseOutput = requireOption(options, 'passphrase-out');
  const pair = dependencies.pair || await SEA.pair();
  protocolCustody.assertPairShape(pair);
  const passphrase = dependencies.passphrase || crypto.randomBytes(32).toString('base64url');
  let passphraseWritten = false;
  try {
    protocolCustody.writePassphraseAtomicSync(passphraseOutput, passphrase, { force: options.force });
    passphraseWritten = true;
    protocolCustody.writeJsonAtomicSync(
      output,
      protocolCustody.sealPair(pair, passphrase, { sequence }),
      { force: options.force },
    );
  } catch (error) {
    if (passphraseWritten && !options.force) {
      try { fs.unlinkSync(path.resolve(passphraseOutput)); } catch (_) { /* best effort */ }
    }
    throw error;
  } finally {
    clearPrivateFields(pair);
  }
  console.log(`Generated encrypted K${sequence} protocol-release vault (mode 600).`);
  console.log(`Vault: ${path.resolve(output)}`);
  console.log(`Passphrase file: ${path.resolve(passphraseOutput)}`);
  console.log(`Public-key fingerprint: ${protocolCustody.fingerprint(pair.pub)}`);
}

function inspect(options) {
  const metadata = protocolCustody.inspectVaultFileSync(requireOption(options, 'key'));
  console.log(`Format: ${metadata.format}`);
  console.log(`Sequence: K${metadata.sequence}`);
  console.log(`Created: ${metadata.createdAt}`);
  console.log(`Public-key fingerprint: ${metadata.fingerprint}`);
  return metadata;
}

async function verifyKey(options, dependencies = {}) {
  const modules = dependencies.modules || ensureCompiled();
  const keyFile = requireOption(options, 'key');
  const passphrase = protocolCustody.readPassphraseFileSync(requireOption(options, 'passphrase-file'));
  const pair = protocolCustody.loadProtocolReleasePairSync({ keyFile, passphrase });
  try {
    await verifyPair(pair, modules);
    const metadata = protocolCustody.inspectVaultFileSync(keyFile);
    console.log(`K${metadata.sequence} vault decrypted and signing self-check passed.`);
    console.log(`Public-key fingerprint: ${metadata.fingerprint}`);
    return metadata;
  } finally {
    clearPrivateFields(pair);
  }
}

function assertPublicHistory(history) {
  const forbidden = new Set(['priv', 'epriv', 'passphrase', 'ciphertext']);
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key.toLowerCase())) throw new Error(`Private field ${key} found in public manifest history.`);
      visit(child);
    }
  };
  visit(history);
}

async function replayHistory(history, modules, now = new Date()) {
  assertPublicHistory(history);
  return modules.protocol.verifyProtocolManifestChain({
    state: modules.production.PRODUCTION_PROTOCOL_MANIFEST_ANCHOR,
    manifests: history,
    runtimePolicy: modules.production.PRODUCTION_PROTOCOL_MANIFEST_RUNTIME,
    now,
  });
}

function manifestDefaults(state, modules) {
  const latest = state.latestManifest;
  const baseline = modules.room.BASELINE_ROOM_PROTOCOL_CHECKPOINT;
  const runtime = modules.production.PRODUCTION_PROTOCOL_MANIFEST_RUNTIME;
  return {
    protocolEpoch: latest?.protocolEpoch || baseline.protocolEpoch,
    minimumManifestEngine: latest?.minimumManifestEngine || runtime.manifestEngineVersion,
    minimumRoomProtocol: latest?.minimumRoomProtocol || runtime.roomProtocolVersion,
    chatroomCapacity: latest?.chatroomCapacity || baseline.chatroomCapacity,
    requiredCapabilities: latest?.requiredCapabilities || [...runtime.capabilities],
    optionalCapabilities: latest?.optionalCapabilities || [],
    retirementMode: latest?.retirementMode || 'none',
    extensions: latest?.extensions,
    criticalExtensions: latest?.criticalExtensions,
  };
}

/**
 * The manifest's extensions: the previous manifest's, with each top-level entry of
 * `--extensions-file` (a JSON object) replacing the entry of the same name. Never critical unless
 * the previous manifest already marked it so. Extensions are public and must hold no private field.
 */
function extensionsOption(options, previous) {
  const merged = { ...(previous || {}) };
  const file = options['extensions-file'];
  if (file) {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--extensions-file must hold a JSON object of named extensions.');
    }
    assertPublicHistory([{ body: { extensions: parsed } }]);
    Object.assign(merged, parsed);
  }
  return Object.keys(merged).length ? merged : undefined;
}

function loadSigningPair(options, expectedSequence) {
  const keyFile = path.resolve(requireOption(options, 'signing-key'));
  const passphraseFile = requireOption(options, 'signing-passphrase-file');
  const envelope = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  if (envelope.format === protocolCustody.KEY_FORMAT) {
    const metadata = protocolCustody.inspectVaultFileSync(keyFile);
    if (metadata.sequence !== expectedSequence) {
      throw new Error(`K${metadata.sequence} cannot sign manifest M${expectedSequence}.`);
    }
    return protocolCustody.loadProtocolReleasePairSync({
      keyFile,
      passphrase: protocolCustody.readPassphraseFileSync(passphraseFile),
    });
  }
  if (expectedSequence !== 2) {
    throw new Error('The legacy TechSupport vault is allowed only for the one-time M2 bridge.');
  }
  const passphrase = protocolCustody.readPassphraseFileSync(passphraseFile);
  return techSupportCustody.loadTechSupportPairSync({ keyFile, passphrase });
}

async function append(options, dependencies = {}) {
  const modules = dependencies.modules || ensureCompiled();
  const history = dependencies.history || readHistory(options);
  const replay = await replayHistory(history, modules);
  if (!replay.ok) throw new Error(`Existing manifest history is invalid: ${replay.reason}`);
  const expectedSequence = integerOption(options, 'expected-sequence');
  if (expectedSequence !== replay.state.sequence + 1) {
    throw new Error(`Expected M${expectedSequence}, but verified history requires M${replay.state.sequence + 1}.`);
  }
  const effectiveAt = requireOption(options, 'effective-at');
  if (!Number.isFinite(Date.parse(effectiveAt))) throw new Error('--effective-at must be an ISO-8601 timestamp.');
  const nextMetadata = protocolCustody.inspectVaultFileSync(requireOption(options, 'next-key'));
  if (nextMetadata.sequence !== expectedSequence + 1) {
    throw new Error(`M${expectedSequence} must commit K${expectedSequence + 1}, not K${nextMetadata.sequence}.`);
  }
  const previouslyAuthorized = new Set([
    ...modules.production.PRODUCTION_PROTOCOL_MANIFEST_ANCHOR.nextReleaseKeys.map((key) => key.publicKey),
    ...history.flatMap((manifest) => manifest.body.nextReleaseKeys.map((key) => key.publicKey)),
  ]);
  const recoveryKeys = new Set([
    ...modules.production.PRODUCTION_PROTOCOL_MANIFEST_ANCHOR.recoveryPolicy.keys.map((key) => key.publicKey),
    ...history.flatMap((manifest) => manifest.body.recoveryPolicy.keys.map((key) => key.publicKey)),
  ]);
  if (previouslyAuthorized.has(nextMetadata.pub)) {
    throw new Error(`K${nextMetadata.sequence} reuses a previously authorized ordinary release key.`);
  }
  if (recoveryKeys.has(nextMetadata.pub)) {
    throw new Error(`K${nextMetadata.sequence} reuses a recovery key.`);
  }
  const defaults = manifestDefaults(replay.state, modules);
  const retirementMode = options['retirement-mode'] || defaults.retirementMode;
  if (retirementMode !== 'none' && retirementMode !== 'network-only') {
    throw new Error('--retirement-mode must be none or network-only.');
  }
  const body = {
    kind: modules.protocol.PROTOCOL_MANIFEST_KIND,
    formatVersion: modules.protocol.PROTOCOL_MANIFEST_FORMAT_VERSION,
    networkId: replay.state.networkId,
    sequence: expectedSequence,
    previousManifestHash: replay.state.manifestHash,
    protocolEpoch: integerOption(options, 'protocol-epoch', defaults.protocolEpoch),
    effectiveAt: new Date(effectiveAt).toISOString(),
    minimumManifestEngine: integerOption(options, 'minimum-engine', defaults.minimumManifestEngine),
    minimumRoomProtocol: integerOption(options, 'minimum-room-protocol', defaults.minimumRoomProtocol),
    chatroomCapacity: integerOption(options, 'capacity', defaults.chatroomCapacity),
    requiredCapabilities: listOption(options, 'required-capabilities', defaults.requiredCapabilities),
    optionalCapabilities: listOption(options, 'optional-capabilities', defaults.optionalCapabilities),
    ...(options['legacy-allowed-until']
      ? { legacyEpochAllowedUntil: new Date(requireOption(options, 'legacy-allowed-until')).toISOString() }
      : {}),
    retirementMode,
    nextReleaseKeys: [modules.protocol.createProtocolReleaseKey(nextMetadata.pub)],
    recoveryPolicy: replay.state.recoveryPolicy,
    signatureAlgorithm: modules.protocol.PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
  };
  const extensions = extensionsOption(options, defaults.extensions);
  if (extensions) body.extensions = extensions;
  if (defaults.criticalExtensions?.length) body.criticalExtensions = defaults.criticalExtensions;
  const signer = loadSigningPair(options, expectedSequence);
  try {
    if (!replay.state.nextReleaseKeys.some((key) => key.publicKey === signer.pub)) {
      throw new Error(`Signing key is not authorized by checkpoint sequence ${replay.state.sequence}.`);
    }
    const manifest = await modules.protocol.signProtocolManifest(body, signer);
    const nextHistory = [...history, manifest];
    const verified = await replayHistory(nextHistory, modules, new Date(body.effectiveAt));
    if (!verified.ok || verified.state.sequence !== expectedSequence) {
      throw new Error(`New manifest failed full-chain verification: ${verified.reason || 'wrong sequence'}`);
    }
    if (!dependencies.noWrite) {
      protocolCustody.writeJsonAtomicSync(historyPath(options), nextHistory, {
        force: true,
        mode: 0o644,
        directoryMode: 0o755,
      });
    }
    console.log(`Appended verified M${expectedSequence}; it commits dedicated K${expectedSequence + 1}.`);
    console.log(`Manifest hash: ${modules.protocol.protocolManifestHash(manifest)}`);
    console.log(`Next-key fingerprint: ${nextMetadata.fingerprint}`);
    return manifest;
  } finally {
    clearPrivateFields(signer);
  }
}

async function status(options, dependencies = {}) {
  const modules = dependencies.modules || ensureCompiled();
  const history = dependencies.history || readHistory(options);
  const replay = await replayHistory(history, modules);
  if (!replay.ok) throw new Error(`Manifest history is invalid: ${replay.reason}`);
  const compatibility = replay.compatibility || { status: 'compatible' };
  console.log(`Verified manifests: ${history.length}`);
  console.log(`Checkpoint sequence: ${replay.state.sequence}`);
  console.log(`Checkpoint hash: ${replay.state.manifestHash}`);
  console.log(`Compatibility: ${compatibility.status}`);
  replay.state.nextReleaseKeys.forEach((key, index) => {
    console.log(`Authorized next key ${index + 1}: ${protocolCustody.fingerprint(key.publicKey)}`);
  });
  return replay;
}

async function verifyProduction(options, dependencies = {}) {
  const modules = dependencies.modules || ensureCompiled();
  const history = dependencies.history || readHistory(options);
  const replay = await replayHistory(history, modules);
  if (!replay.ok) throw new Error(`Manifest history is invalid: ${replay.reason}`);
  if (history.length < 1 || replay.state.sequence < 2) {
    throw new Error('Production history has not bridged the legacy genesis key into a dedicated key.');
  }
  const ordinaryKeys = new Set(
    modules.production.PRODUCTION_PROTOCOL_MANIFEST_ANCHOR.nextReleaseKeys.map((key) => key.publicKey),
  );
  const recoveryKeys = new Set(
    modules.production.PRODUCTION_PROTOCOL_MANIFEST_ANCHOR.recoveryPolicy.keys.map((key) => key.publicKey),
  );
  for (const manifest of history) {
    for (const key of manifest.body.recoveryPolicy.keys) recoveryKeys.add(key.publicKey);
    for (const key of manifest.body.nextReleaseKeys) {
      if (ordinaryKeys.has(key.publicKey)) throw new Error('Production history reuses an ordinary release key.');
      if (recoveryKeys.has(key.publicKey)) throw new Error('Production history reuses a recovery key as an ordinary key.');
      ordinaryKeys.add(key.publicKey);
    }
  }
  console.log(`Protocol manifest production gate passed at sequence ${replay.state.sequence}.`);
  return replay;
}

async function main(argv = process.argv.slice(2), dependencies = {}) {
  const options = parseOptions(argv);
  const [command] = options._;
  if (!command || command === 'help') {
    console.log(usage());
    return;
  }
  if (command === 'generate') return generate(options, dependencies);
  if (command === 'inspect') return inspect(options);
  if (command === 'verify-key') return verifyKey(options, dependencies);
  if (command === 'append') return append(options, dependencies);
  if (command === 'status') return status(options, dependencies);
  if (command === 'verify-production') return verifyProduction(options, dependencies);
  throw new Error(`Unknown command ${command}.\n\n${usage()}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[protocol-manifest] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  append,
  assertPublicHistory,
  extensionsOption,
  clearPrivateFields,
  generate,
  integerOption,
  listOption,
  main,
  parseOptions,
  replayHistory,
  status,
  verifyKey,
  verifyProduction,
};
