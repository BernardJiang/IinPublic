'use strict';

// Canonical server-only implementation; operator scripts import this source directly.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_FORMAT = 'iinpublic-techsupport-key-v1';
const SCRYPT_PARAMETERS = Object.freeze({ name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32 });
const REQUIRED_PAIR_FIELDS = Object.freeze(['pub', 'epub', 'priv', 'epriv']);

function assertPairShape(pair) {
  if (!pair || typeof pair !== 'object') throw new Error('TechSupport key must be a JSON object.');
  const missing = REQUIRED_PAIR_FIELDS.filter(
    (field) => typeof pair[field] !== 'string' || pair[field].trim().length === 0,
  );
  if (missing.length > 0) {
    throw new Error(`TechSupport key is missing required fields: ${missing.join(', ')}.`);
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

function publicMetadata(envelope) {
  return {
    format: envelope.format,
    version: envelope.version,
    role: envelope.role,
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
  if (!kdf || kdf.name !== 'scrypt') throw new Error('Unsupported TechSupport vault KDF.');
  if (
    kdf.N !== SCRYPT_PARAMETERS.N ||
    kdf.r !== SCRYPT_PARAMETERS.r ||
    kdf.p !== SCRYPT_PARAMETERS.p ||
    kdf.keyLength !== SCRYPT_PARAMETERS.keyLength ||
    typeof kdf.salt !== 'string'
  ) {
    throw new Error('Unsupported or invalid TechSupport vault scrypt parameters.');
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
    throw new Error('TechSupport vault passphrase must contain at least 16 characters.');
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
    role: options.role || 'unified',
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
    throw new Error('File is not a supported IinPublic TechSupport encrypted key vault.');
  }
  if (
    typeof envelope.pub !== 'string' ||
    typeof envelope.epub !== 'string' ||
    !envelope.cipher ||
    envelope.cipher.name !== 'aes-256-gcm' ||
    typeof envelope.cipher.iv !== 'string' ||
    typeof envelope.cipher.tag !== 'string' ||
    typeof envelope.cipher.ciphertext !== 'string'
  ) {
    throw new Error('TechSupport encrypted key vault is malformed.');
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
      throw new Error('TechSupport vault public metadata does not match the encrypted key.');
    }
    return pair;
  } catch (error) {
    if (error && error.message === 'TechSupport vault public metadata does not match the encrypted key.') {
      throw error;
    }
    throw new Error('Unable to unlock TechSupport key vault (wrong passphrase or damaged file).');
  } finally {
    key.fill(0);
  }
}

function readPassphraseSync(env = process.env) {
  if (env.TECHSUPPORT_KEY_PASSPHRASE_FILE) {
    const passphrasePath = path.resolve(env.TECHSUPPORT_KEY_PASSPHRASE_FILE);
    assertPrivateFilePermissions(passphrasePath);
    const value = fs.readFileSync(passphrasePath, 'utf8').replace(/[\r\n]+$/, '');
    assertPassphrase(value);
    return value;
  }
  if (env.TECHSUPPORT_KEY_PASSPHRASE) {
    assertPassphrase(env.TECHSUPPORT_KEY_PASSPHRASE);
    return env.TECHSUPPORT_KEY_PASSPHRASE;
  }
  throw new Error(
    'Set TECHSUPPORT_KEY_PASSPHRASE_FILE (preferred) or TECHSUPPORT_KEY_PASSPHRASE to unlock the encrypted TechSupport key vault.',
  );
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read TechSupport key file ${filePath}: ${error.message}`);
  }
}

function inspectVaultFileSync(filePath) {
  const resolved = path.resolve(filePath);
  const envelope = assertEnvelopeShape(readJson(resolved));
  return { ...publicMetadata(envelope), fingerprint: fingerprint(envelope.pub) };
}

function loadTechSupportPairSync(options = {}) {
  const env = options.env || process.env;
  const keyFilePath = options.keyFile || env.TECHSUPPORT_KEY_FILE;
  if (keyFilePath) {
    const resolved = path.resolve(keyFilePath);
    assertPrivateFilePermissions(resolved);
    const parsed = readJson(resolved);
    if (parsed && parsed.format === KEY_FORMAT) {
      return unsealPair(parsed, options.passphrase || readPassphraseSync(env));
    }
    return assertPairShape(parsed);
  }
  if (env.TECHSUPPORT_SEA_PAIR_JSON) {
    try {
      return assertPairShape(JSON.parse(env.TECHSUPPORT_SEA_PAIR_JSON));
    } catch (error) {
      throw new Error(`TECHSUPPORT_SEA_PAIR_JSON is invalid: ${error.message}`);
    }
  }
  throw new Error(
    'Set TECHSUPPORT_KEY_FILE to an encrypted vault (preferred), or use the legacy TECHSUPPORT_SEA_PAIR_JSON setting.',
  );
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

function fingerprint(pub) {
  return crypto.createHash('sha256').update(pub, 'utf8').digest('hex').match(/.{1,4}/g).join(':');
}

module.exports = {
  KEY_FORMAT,
  SCRYPT_PARAMETERS,
  assertEnvelopeShape,
  assertPairShape,
  assertPrivateFilePermissions,
  fingerprint,
  inspectVaultFileSync,
  loadTechSupportPairSync,
  readPassphraseSync,
  sealPair,
  unsealPair,
  writeJsonAtomicSync,
};
