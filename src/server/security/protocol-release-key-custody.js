'use strict';

// Server/operator-only custody for one-time protocol-manifest signing keys. This intentionally
// uses a distinct envelope format and environment namespace from TechSupport, Android, and
// artifact-signing keys so a vault cannot be accepted silently in the wrong security role.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FORMAT = 'iinpublic-protocol-release-key-v1';
const SCRYPT_PARAMETERS = Object.freeze({ name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 });
const REQUIRED_PAIR_FIELDS = Object.freeze(['pub', 'epub', 'priv', 'epriv']);

function assertPairShape(pair) {
  if (!pair || typeof pair !== 'object') throw new Error('Protocol release key must be a JSON object.');
  const missing = REQUIRED_PAIR_FIELDS.filter(
    (field) => typeof pair[field] !== 'string' || pair[field].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`Protocol release key is missing required fields: ${missing.join(', ')}.`);
  }
  return pair;
}

function assertPrivateFilePermissions(filePath) {
  if (process.platform === 'win32') return;
  const mode = fs.statSync(filePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to read private protocol-release material from ${filePath}: permissions `
      + `${mode.toString(8)} allow group/other access; run chmod 600 on the file.`,
    );
  }
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 16) {
    throw new Error('Protocol release vault passphrase must contain at least 16 characters.');
  }
}

function publicMetadata(envelope) {
  return {
    format: envelope.format,
    version: envelope.version,
    role: envelope.role,
    sequence: envelope.sequence,
    pub: envelope.pub,
    epub: envelope.epub,
    createdAt: envelope.createdAt,
    kdf: envelope.kdf,
    cipher: { name: envelope.cipher.name, iv: envelope.cipher.iv },
  };
}

function authenticatedData(envelope) {
  return Buffer.from(JSON.stringify(publicMetadata(envelope)), 'utf8');
}

function deriveKey(passphrase, kdf) {
  if (!kdf || kdf.name !== 'scrypt') throw new Error('Unsupported protocol release vault KDF.');
  if (
    kdf.N !== SCRYPT_PARAMETERS.N
    || kdf.r !== SCRYPT_PARAMETERS.r
    || kdf.p !== SCRYPT_PARAMETERS.p
    || kdf.keyLength !== SCRYPT_PARAMETERS.keyLength
    || typeof kdf.salt !== 'string'
  ) {
    throw new Error('Unsupported or invalid protocol release vault scrypt parameters.');
  }
  return crypto.scryptSync(passphrase, Buffer.from(kdf.salt, 'base64'), kdf.keyLength, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
}

function assertSequence(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 2) {
    throw new Error('Protocol release key sequence must be an integer of at least 2.');
  }
}

function sealPair(pair, passphrase, options = {}) {
  assertPairShape(pair);
  assertPassphrase(passphrase);
  assertSequence(options.sequence);
  const salt = options.salt || crypto.randomBytes(16);
  const iv = options.iv || crypto.randomBytes(12);
  const envelope = {
    format: KEY_FORMAT,
    version: 1,
    role: 'protocol-manifest-signing',
    sequence: options.sequence,
    pub: pair.pub,
    epub: pair.epub,
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
    throw new Error('File is not a supported IinPublic protocol release encrypted key vault.');
  }
  assertSequence(envelope.sequence);
  if (
    envelope.role !== 'protocol-manifest-signing'
    || typeof envelope.pub !== 'string'
    || typeof envelope.epub !== 'string'
    || !envelope.cipher
    || envelope.cipher.name !== 'aes-256-gcm'
    || typeof envelope.cipher.iv !== 'string'
    || typeof envelope.cipher.tag !== 'string'
    || typeof envelope.cipher.ciphertext !== 'string'
  ) {
    throw new Error('Protocol release encrypted key vault is malformed.');
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
    if (pair.pub !== envelope.pub || pair.epub !== envelope.epub) {
      throw new Error('Protocol release vault public metadata does not match the encrypted key.');
    }
    return pair;
  } catch (error) {
    if (error && error.message === 'Protocol release vault public metadata does not match the encrypted key.') {
      throw error;
    }
    throw new Error('Unable to unlock protocol release key vault (wrong passphrase or damaged file).');
  } finally {
    key.fill(0);
  }
}

function readPassphraseFileSync(filePath) {
  const resolved = path.resolve(filePath);
  assertPrivateFilePermissions(resolved);
  const value = fs.readFileSync(resolved, 'utf8').replace(/[\r\n]+$/, '');
  assertPassphrase(value);
  return value;
}

function readPassphraseSync(env = process.env) {
  if (env.PROTOCOL_RELEASE_KEY_PASSPHRASE_FILE) {
    return readPassphraseFileSync(env.PROTOCOL_RELEASE_KEY_PASSPHRASE_FILE);
  }
  if (env.PROTOCOL_RELEASE_KEY_PASSPHRASE) {
    assertPassphrase(env.PROTOCOL_RELEASE_KEY_PASSPHRASE);
    return env.PROTOCOL_RELEASE_KEY_PASSPHRASE;
  }
  throw new Error(
    'Set PROTOCOL_RELEASE_KEY_PASSPHRASE_FILE (preferred) or '
    + 'PROTOCOL_RELEASE_KEY_PASSPHRASE to unlock the protocol release vault.',
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read protocol release key file ${filePath}: ${error.message}`);
  }
}

function inspectVaultFileSync(filePath) {
  const resolved = path.resolve(filePath);
  const envelope = assertEnvelopeShape(readJson(resolved));
  return { ...publicMetadata(envelope), fingerprint: fingerprint(envelope.pub) };
}

function loadProtocolReleasePairSync(options = {}) {
  const env = options.env || process.env;
  const keyFilePath = options.keyFile || env.PROTOCOL_RELEASE_KEY_FILE;
  if (!keyFilePath) throw new Error('Set PROTOCOL_RELEASE_KEY_FILE to an encrypted vault.');
  const resolved = path.resolve(keyFilePath);
  assertPrivateFilePermissions(resolved);
  const envelope = assertEnvelopeShape(readJson(resolved));
  const passphrase = options.passphrase || readPassphraseSync(env);
  return unsealPair(envelope, passphrase);
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

function writePassphraseAtomicSync(filePath, passphrase, options = {}) {
  assertPassphrase(passphrase);
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  if (!options.force && fs.existsSync(resolved)) {
    throw new Error(`Refusing to overwrite existing passphrase file ${resolved}.`);
  }
  const temporary = `${resolved}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, `${passphrase}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, resolved);
    fs.chmodSync(resolved, 0o600);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch (_) { /* best effort */ }
    throw error;
  }
  return resolved;
}

function fingerprint(pub) {
  return crypto.createHash('sha256').update(pub, 'utf8').digest('hex').match(/.{1,4}/g).join(':');
}

module.exports = {
  KEY_FORMAT,
  SCRYPT_PARAMETERS,
  assertEnvelopeShape,
  assertPairShape,
  assertPrivateFilePermissions,
  assertSequence,
  fingerprint,
  inspectVaultFileSync,
  loadProtocolReleasePairSync,
  readPassphraseFileSync,
  readPassphraseSync,
  sealPair,
  unsealPair,
  writeJsonAtomicSync,
  writePassphraseAtomicSync,
};
