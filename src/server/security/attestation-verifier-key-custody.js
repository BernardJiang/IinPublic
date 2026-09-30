'use strict';

// Canonical server-only implementation; operator scripts import this source directly.
//
// Vault format/custody model deliberately mirrors techsupport-key-custody.js (same encrypted-
// vault-JSON + passphrase-file convention, same scrypt/AES-256-GCM shape, same file-permission
// check) — see docs/IinPublic Identity & Key Architecture TODO.md §16.8 for why this is a
// SEPARATE key from TechSupport's, not a shared one. Kept as a parallel, self-contained module
// rather than refactored into a shared abstraction with techsupport-key-custody.js: that module
// backs a live production system, and this repo already keeps techsupport-key-tool.js separate
// from whatever tool a new key type needs rather than generalizing prematurely.
//
// Key shape differs from TechSupport's SEA pair: this is a plain Node `crypto` EC (P-256)
// keypair (PEM-encoded SPKI/PKCS8), not a SEA {pub,epub,priv,epriv} pair — see §16.8 for why
// (SEA.sign/verify are hard-coupled to WebCrypto and documented to fail on the embedded mobile
// server; this key never needs to interoperate with SEA identities).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FORMAT = 'iinpublic-attestation-verifier-key-v1';
const SCRYPT_PARAMETERS = Object.freeze({ name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 });
const REQUIRED_PAIR_FIELDS = Object.freeze(['publicKeyPem', 'privateKeyPem']);

function assertPairShape(pair) {
  if (!pair || typeof pair !== 'object') throw new Error('Attestation verifier key must be a JSON object.');
  const missing = REQUIRED_PAIR_FIELDS.filter(
    (field) => typeof pair[field] !== 'string' || pair[field].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Attestation verifier key is missing required fields: ${missing.join(', ')}.`);
  }
  return pair;
}

function assertPrivateFilePermissions(filePath) {
  if (process.platform === 'win32') return;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to read private key material from ${filePath}: permissions ${mode.toString(8)} ` +
        'allow group/other access; run chmod 600 on the file.',
    );
  }
}

/** SHA-256 hex fingerprint of the public key PEM, colon-grouped — used as `verifierKeyId` in an
 * OfficialBuildCredential (§16.5) so a peer can pick the right published key to verify against
 * without a lookup. */
function fingerprint(publicKeyPem) {
  return crypto.createHash('sha256').update(publicKeyPem, 'utf8').digest('hex').match(/.{1,4}/g).join(':');
}

function publicMetadata(envelope) {
  return {
    format: envelope.format,
    version: envelope.version,
    role: envelope.role,
    publicKeyPem: envelope.publicKeyPem,
    createdAt: envelope.createdAt,
    kdf: envelope.kdf,
    cipher: { name: envelope.cipher.name, iv: envelope.cipher.iv },
  };
}

function authenticatedData(envelope) {
  return Buffer.from(JSON.stringify(publicMetadata(envelope)), 'utf8');
}

function deriveKey(passphrase, kdf) {
  if (!kdf || kdf.name !== 'scrypt') throw new Error('Unsupported attestation verifier vault KDF.');
  if (
    kdf.N !== SCRYPT_PARAMETERS.N ||
    kdf.r !== SCRYPT_PARAMETERS.r ||
    kdf.p !== SCRYPT_PARAMETERS.p ||
    kdf.keyLength !== SCRYPT_PARAMETERS.keyLength ||
    typeof kdf.salt !== 'string'
  ) {
    throw new Error('Unsupported or invalid attestation verifier vault scrypt parameters.');
  }
  return crypto.scryptSync(passphrase, Buffer.from(kdf.salt, 'base64'), kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Attestation verifier vault passphrase must contain at least 16 characters.');
  }
}

function sealPair(pair, passphrase, options = {}) {
  assertPairShape(pair);
  assertPassphrase(passphrase);
  const salt = options.salt || crypto.randomBytes(16);
  const iv = options.iv || crypto.randomBytes(12);
  const envelope = {
    format: KEY_FORMAT,
    version: 1,
    role: options.role || 'attestation-verifier',
    publicKeyPem: pair.publicKeyPem,
    createdAt: options.createdAt || new Date().toISOString(),
    kdf: { ...SCRYPT_PARAMETERS, salt: Buffer.from(salt).toString('base64') },
    cipher: { name: 'aes-256-gcm', iv: Buffer.from(iv).toString('base64') },
  };
  const key = deriveKey(passphrase, envelope.kdf);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(authenticatedData(envelope));
  const plaintext = Buffer.from(JSON.stringify(pair), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  envelope.cipher.tag = cipher.getAuthTag().toString('base64');
  envelope.cipher.ciphertext = ciphertext.toString('base64');
  key.fill(0);
  plaintext.fill(0);
  return envelope;
}

function assertEnvelopeShape(envelope) {
  if (!envelope || envelope.format !== KEY_FORMAT || envelope.version !== 1) {
    throw new Error('File is not a supported IinPublic attestation-verifier encrypted key vault.');
  }
  if (
    typeof envelope.publicKeyPem !== 'string' ||
    !envelope.cipher ||
    envelope.cipher.name !== 'aes-256-gcm' ||
    typeof envelope.cipher.iv !== 'string' ||
    typeof envelope.cipher.tag !== 'string' ||
    typeof envelope.cipher.ciphertext !== 'string'
  ) {
    throw new Error('Attestation verifier encrypted key vault is malformed.');
  }
  return envelope;
}

function unsealPair(envelope, passphrase) {
  assertEnvelopeShape(envelope);
  assertPassphrase(passphrase);
  const key = deriveKey(passphrase, envelope.kdf);
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'base64'),
    );
    decipher.setAAD(authenticatedData(envelope));
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.cipher.ciphertext, 'base64')),
      decipher.final(),
    ]);
    const pair = assertPairShape(JSON.parse(plaintext.toString('utf8')));
    plaintext.fill(0);
    if (pair.publicKeyPem !== envelope.publicKeyPem) {
      throw new Error('Attestation verifier vault public metadata does not match the encrypted key.');
    }
    return pair;
  } catch (error) {
    if (
      error &&
      error.message === 'Attestation verifier vault public metadata does not match the encrypted key.'
    ) {
      throw error;
    }
    throw new Error('Unable to unlock attestation verifier key vault (wrong passphrase or damaged file).');
  } finally {
    key.fill(0);
  }
}

function readPassphraseSync(env = process.env) {
  if (env.ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE) {
    const passphrasePath = path.resolve(env.ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE);
    assertPrivateFilePermissions(passphrasePath);
    const value = fs.readFileSync(passphrasePath, 'utf8').replace(/[\r\n]+$/, '');
    assertPassphrase(value);
    return value;
  }
  if (env.ATTESTATION_VERIFIER_KEY_PASSPHRASE) {
    assertPassphrase(env.ATTESTATION_VERIFIER_KEY_PASSPHRASE);
    return env.ATTESTATION_VERIFIER_KEY_PASSPHRASE;
  }
  throw new Error(
    'Set ATTESTATION_VERIFIER_KEY_PASSPHRASE_FILE (preferred) or ATTESTATION_VERIFIER_KEY_PASSPHRASE ' +
      'to unlock the encrypted attestation verifier key vault.',
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read attestation verifier key file ${filePath}: ${error.message}`);
  }
}

function inspectVaultFileSync(filePath) {
  const resolved = path.resolve(filePath);
  const envelope = assertEnvelopeShape(readJson(resolved));
  return { ...publicMetadata(envelope), fingerprint: fingerprint(envelope.publicKeyPem) };
}

function loadVerifierPairSync(options = {}) {
  const env = options.env || process.env;
  const keyFilePath = options.keyFile || env.ATTESTATION_VERIFIER_KEY_FILE;
  if (keyFilePath) {
    const resolved = path.resolve(keyFilePath);
    assertPrivateFilePermissions(resolved);
    const parsed = readJson(resolved);
    if (parsed && parsed.format === KEY_FORMAT) {
      return unsealPair(parsed, options.passphrase || readPassphraseSync(env));
    }
    return assertPairShape(parsed);
  }
  throw new Error('Set ATTESTATION_VERIFIER_KEY_FILE to an encrypted vault.');
}

function writeJsonAtomicSync(filePath, value, options = {}) {
  const resolved = path.resolve(filePath);
  const mode = options.mode === undefined ? 0o600 : options.mode;
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: options.directoryMode || 0o700 });
  if (!options.force && fs.existsSync(resolved)) {
    throw new Error(`Refusing to overwrite existing file ${resolved}; pass --force only after backing it up.`);
  }
  const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode, flag: 'wx' });
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, mode);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
    throw error;
  }
  return resolved;
}

/** Generates a fresh P-256 EC keypair in the {publicKeyPem, privateKeyPem} shape this module's
 * vault expects. Not itself persisted — callers (the key tool) decide whether/how to seal it. */
function generateVerifierKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKeyPem: publicKey, privateKeyPem: privateKey };
}

/** Signs `data` (a Buffer or utf8 string — the caller is responsible for canonicalizing whatever
 * JSON it represents before calling this) with the verifier's private key. ECDSA/SHA-256, DER
 * signature encoding (Node's default) — base64-encoded for JSON transport. */
function signWithVerifierKey(privateKeyPem, data) {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  const signature = crypto.sign('sha256', buffer, { key: privateKeyPem, dsaEncoding: 'der' });
  return signature.toString('base64');
}

/** Verifies a base64 DER ECDSA signature against `data` and a public key PEM. Never throws on a
 * bad signature — returns false, so callers can treat "invalid" as an ordinary rejection reason
 * rather than an exceptional code path (this data crosses a trust boundary; a malformed
 * signature must degrade gracefully, not crash the verifier). */
function verifyWithVerifierKey(publicKeyPem, data, signatureBase64) {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const signature = Buffer.from(signatureBase64, 'base64');
    return crypto.verify('sha256', buffer, { key: publicKeyPem, dsaEncoding: 'der' }, signature);
  } catch (_) {
    return false;
  }
}

module.exports = {
  KEY_FORMAT,
  SCRYPT_PARAMETERS,
  assertEnvelopeShape,
  assertPairShape,
  assertPrivateFilePermissions,
  fingerprint,
  generateVerifierKeyPair,
  inspectVaultFileSync,
  loadVerifierPairSync,
  readPassphraseSync,
  sealPair,
  signWithVerifierKey,
  unsealPair,
  verifyWithVerifierKey,
  writeJsonAtomicSync,
};
