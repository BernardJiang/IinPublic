'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  clearPrivateFields,
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
