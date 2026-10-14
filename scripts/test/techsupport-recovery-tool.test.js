'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  clearPrivateFields,
  findLocalRecoveryMaterial,
  main,
  normalizeApiBase,
  parseOptions,
  publish,
  readRecoveryPassphraseSync,
} = require('../techsupport-recovery-tool');

test('recovery tool accepts HTTPS and loopback HTTP but rejects remote plaintext transport', () => {
  assert.equal(normalizeApiBase('https://www.iinpublic.com/'), 'https://www.iinpublic.com');
  assert.equal(normalizeApiBase('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => normalizeApiBase('http://example.com'), /must use HTTPS/);
  assert.throws(() => normalizeApiBase('https://user:secret@example.com'), /must not contain credentials/);
});

test('recovery tool parses repeated --revoke-dm/--revoke-announcement into arrays, and --dry-run without consuming another option', () => {
  assert.deepEqual(
    parseOptions([
      'publish', '--dry-run',
      '--revoke-dm', 'old-1', '--revoke-dm', 'old-2',
      '--revoke-announcement', 'old-3',
      '--next-dm', 'new-1',
    ]),
    {
      _: ['publish'],
      dryRun: true,
      revokeDm: ['old-1', 'old-2'],
      revokeAnnouncement: ['old-3'],
      'next-dm': 'new-1',
    },
  );
});

test('recovery tool reads its own separate passphrase env vars, distinct from the DM vault\'s', () => {
  assert.throws(
    () => readRecoveryPassphraseSync({}),
    /Set TECHSUPPORT_KEY_PASSPHRASE_FILE.*or TECHSUPPORT_KEY_PASSPHRASE/,
  );
  // The DM vault's own passphrase env vars must NOT be read by the recovery tool.
  assert.throws(
    () => readRecoveryPassphraseSync({ TECHSUPPORT_KEY_PASSPHRASE: 'a'.repeat(20) }),
    /Set TECHSUPPORT_KEY_PASSPHRASE_FILE.*or TECHSUPPORT_KEY_PASSPHRASE/,
  );
  assert.equal(
    readRecoveryPassphraseSync({ TECHSUPPORT_RECOVERY_KEY_PASSPHRASE: 'a'.repeat(20) }),
    'a'.repeat(20),
  );
});

test('recovery tool passphrase file source works and is separate from the DM vault\'s file setting', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-recovery-tool-'));
  const passphraseFile = path.join(directory, 'passphrase.txt');
  fs.writeFileSync(passphraseFile, 'a'.repeat(24) + '\n', { mode: 0o600 });
  try {
    assert.equal(
      readRecoveryPassphraseSync({ TECHSUPPORT_RECOVERY_KEY_PASSPHRASE_FILE: passphraseFile }),
      'a'.repeat(24),
    );
    // Only the recovery-specific file var is honored — the DM one is ignored here.
    assert.throws(
      () => readRecoveryPassphraseSync({ TECHSUPPORT_KEY_PASSPHRASE_FILE: passphraseFile }),
      /Set TECHSUPPORT_KEY_PASSPHRASE_FILE.*or TECHSUPPORT_KEY_PASSPHRASE/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('publish signs and posts only the public record, never the recovery private pair, and reports revocations/next-anchors', async () => {
  const pair = { pub: 'recovery-pub', epub: 'recovery-epub', priv: 'recovery-private', epriv: 'recovery-eprivate' };
  const record = {
    recoveryPub: pair.pub,
    revokedDmPubs: ['old-dm-pub'],
    revokedAnnouncementPubs: [],
    nextDmPub: 'new-dm-pub',
    nextAnnouncementPub: null,
    issuedAt: '2026-09-22T00:00:00.000Z',
    reason: 'root key compromised',
    signature: 'recovery-signature',
  };
  const recovery = {
    signRecoveryAnchor: async (input, signer) => {
      assert.equal(signer, pair);
      assert.deepEqual(input.revokedDmPubs, ['old-dm-pub']);
      assert.equal(input.nextDmPub, 'new-dm-pub');
      assert.equal(input.reason, 'root key compromised');
      return record;
    },
  };
  let requestBody = '';
  const request = async (url, options) => {
    assert.equal(url, 'https://www.iinpublic.com/api/support/recovery');
    requestBody = options.body;
    return { stored: true };
  };

  // Shape as parseOptions would actually produce it (revokeDm, not the raw --revoke-dm flag name).
  const result = await publish(
    { revokeDm: ['old-dm-pub'], revokeAnnouncement: [], 'next-dm': 'new-dm-pub', reason: 'root key compromised' },
    pair,
    recovery,
    'https://www.iinpublic.com',
    request,
  );

  assert.equal(result, record);
  assert.deepEqual(JSON.parse(requestBody), record);
  assert.equal(requestBody.includes(pair.priv), false);
  assert.equal(requestBody.includes(pair.epriv), false);
});

test('publish --dry-run signs but never calls the request function', async () => {
  const pair = { pub: 'recovery-pub' };
  const record = {
    recoveryPub: 'recovery-pub',
    revokedDmPubs: [],
    revokedAnnouncementPubs: [],
    nextDmPub: null,
    nextAnnouncementPub: null,
    issuedAt: '2026-09-22T00:00:00.000Z',
    reason: 'x',
    signature: 'sig',
  };
  const recovery = { signRecoveryAnchor: async () => record };
  let called = false;
  const request = async () => {
    called = true;
    return { stored: true };
  };
  const result = await publish({ dryRun: true, reason: 'x' }, pair, recovery, 'https://www.iinpublic.com', request);
  assert.equal(result, record);
  assert.equal(called, false);
});

test('publish requires --reason', async () => {
  const pair = { pub: 'recovery-pub' };
  const recovery = { signRecoveryAnchor: async () => { throw new Error('should not sign without a reason'); } };
  await assert.rejects(
    () => publish({}, pair, recovery, 'https://www.iinpublic.com', async () => ({})),
    /Missing required option --reason/,
  );
});

test('publish rejects a reason exceeding the length bound', async () => {
  const pair = { pub: 'recovery-pub' };
  const recovery = { signRecoveryAnchor: async () => { throw new Error('should not sign an over-length reason'); } };
  await assert.rejects(
    () => publish({ reason: 'x'.repeat(501) }, pair, recovery, 'https://www.iinpublic.com', async () => ({})),
    /exceeds 500 characters/,
  );
});

test('clearPrivateFields drops both private fields from the short-lived pair object', () => {
  const pair = { pub: 'pub', epub: 'epub', priv: 'private', epriv: 'encryption-private' };
  clearPrivateFields(pair);
  assert.equal(pair.priv, '');
  assert.equal(pair.epriv, '');
});

test('custody-check finds a recovery vault, its passphrase and .env recovery settings, never their values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-recovery-custody-'));
  try {
    fs.mkdirSync(path.join(root, 'secrets'));
    const vault = { format: 'iinpublic-techsupport-key-v1', role: 'recovery', pub: 'p', cipher: { ciphertext: 'secret-bytes' } };
    fs.writeFileSync(path.join(root, 'secrets', 'techsupport-recovery.key.json'), JSON.stringify(vault));
    fs.writeFileSync(path.join(root, 'secrets', 'techsupport-recovery.key.passphrase'), 'pass-value');
    // A DM vault and unrelated secrets are not recovery material.
    fs.writeFileSync(path.join(root, 'secrets', 'techsupport-master.key.json'), JSON.stringify({ ...vault, role: 'unified' }));
    fs.writeFileSync(path.join(root, 'secrets', 'android-release.keystore.passphrase'), 'x');
    fs.writeFileSync(path.join(root, '.env.local'), [
      'TECHSUPPORT_SEA_PAIR_JSON={"pub":"dm"}',
      'export TECHSUPPORT_RECOVERY_SEA_PAIR_JSON={"priv":"recovery-private"}',
      '# TECHSUPPORT_RECOVERY_KEY_PASSPHRASE=commented-out',
      'TECHSUPPORT_RECOVERY_KEY_PASSPHRASE=',
    ].join('\n'));

    const findings = findLocalRecoveryMaterial(root);
    assert.deepEqual(findings.map((finding) => finding.location), [
      path.join('secrets', 'techsupport-recovery.key.json'),
      path.join('secrets', 'techsupport-recovery.key.passphrase'),
      '.env.local: TECHSUPPORT_RECOVERY_SEA_PAIR_JSON',
    ]);
    const printed = JSON.stringify(findings);
    for (const value of ['secret-bytes', 'pass-value', 'recovery-private']) assert.equal(printed.includes(value), false);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('custody-check reports a clean machine and leaves the exit code alone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-recovery-custody-'));
  const previousExitCode = process.exitCode;
  try {
    assert.deepEqual(await main(['custody-check'], { root }), []);
    assert.equal(process.exitCode, previousExitCode);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

test('verify accepts only a pinned recovery key and wipes the private fields either way', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-recovery-verify-'));
  const keyFile = path.join(root, 'vault.json');
  fs.writeFileSync(keyFile, JSON.stringify({
    format: 'iinpublic-techsupport-key-v1', version: 1, role: 'recovery', pub: 'pinned', epub: 'e', createdAt: '2026-10-13T00:00:00.000Z',
    kdf: { name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32, salt: 'c2FsdA==' },
    cipher: { name: 'aes-256-gcm', iv: 'aXY=', tag: 'dGFn', ciphertext: 'Y3Q=' },
  }), { mode: 0o600 });
  const techsupport = {
    currentTechSupportRecoveryPub: () => 'pinned',
    isTrustedTechSupportRecoveryPub: (pub) => pub === 'pinned',
  };
  const modules = { techsupport, recovery: {} };
  try {
    const good = { pub: 'pinned', epub: 'e', priv: 'private', epriv: 'eprivate' };
    const result = await main(['verify', '--key', keyFile], { modules, pair: good });
    assert.equal(result.pub, 'pinned');
    assert.equal(good.priv, '');
    assert.equal(good.epriv, '');

    const stranger = { pub: 'other', epub: 'e', priv: 'private', epriv: 'eprivate' };
    await assert.rejects(main(['verify', '--key', keyFile], { modules, pair: stranger }), /not a trusted recovery anchor/);
    assert.equal(stranger.priv, '');
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
