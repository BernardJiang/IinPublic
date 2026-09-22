'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  clearPrivateFields,
  issue,
  loadEncryptedOperatorPair,
  normalizeApiBase,
  parseOptions,
  parseTtlDays,
} = require('../techsupport-delegate-tool');

test('delegate tool accepts HTTPS and loopback HTTP but rejects remote plaintext transport', () => {
  assert.equal(normalizeApiBase('https://www.iinpublic.com/'), 'https://www.iinpublic.com');
  assert.equal(normalizeApiBase('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.throws(() => normalizeApiBase('http://example.com'), /must use HTTPS/);
  assert.throws(() => normalizeApiBase('https://user:secret@example.com'), /must not contain credentials/);
});

test('delegate tool bounds grant lifetime and parses dry-run without consuming another option', () => {
  assert.equal(parseTtlDays(undefined), 30);
  assert.equal(parseTtlDays('1'), 1);
  assert.equal(parseTtlDays('90'), 90);
  assert.throws(() => parseTtlDays('0'), /1 through 90/);
  assert.throws(() => parseTtlDays('90.5'), /1 through 90/);

  assert.deepEqual(
    parseOptions(['issue', '--dry-run', '--delegate-pub', 'pub']),
    { _: ['issue'], dryRun: true, 'delegate-pub': 'pub' },
  );
});

test('delegate tool refuses missing and plaintext legacy root-key sources', () => {
  assert.throws(
    () => loadEncryptedOperatorPair({}, { TECHSUPPORT_SEA_PAIR_JSON: '{"priv":"legacy"}' }),
    /requires an encrypted vault/,
  );

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-delegate-tool-'));
  const plaintext = path.join(directory, 'pair.json');
  fs.writeFileSync(plaintext, JSON.stringify({ pub: 'p', epub: 'e', priv: 's', epriv: 'x' }), { mode: 0o600 });
  try {
    assert.throws(
      () => loadEncryptedOperatorPair({ key: plaintext }, {}),
      /not a supported IinPublic TechSupport encrypted key vault/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true });
  }
});

test('issue publishes only the signed public grant and never serializes the root private pair', async () => {
  const pair = { pub: 'root-pub', epub: 'root-epub', priv: 'root-private', epriv: 'root-eprivate' };
  const grant = {
    delegatePub: 'delegate-pub',
    delegateUserId: 'delegate-user',
    label: 'Support phone',
    issuedAt: '2026-09-21T00:00:00.000Z',
    expiresAt: '2026-10-21T00:00:00.000Z',
    revokedAt: null,
    masterPub: pair.pub,
    signature: 'root-signature',
  };
  const delegates = {
    signDelegateGrant: async (_input, signer) => {
      assert.equal(signer, pair);
      return grant;
    },
  };
  let requestBody = '';
  const request = async (url, options) => {
    assert.equal(url, 'https://www.iinpublic.com/api/support/delegate-grants');
    requestBody = options.body;
    return { stored: true };
  };

  const result = await issue({
    'delegate-user-id': 'delegate-user',
    'delegate-pub': 'delegate-pub',
    label: 'Support phone',
    'ttl-days': '30',
  }, pair, delegates, 'https://www.iinpublic.com', request);

  assert.equal(result, grant);
  assert.deepEqual(JSON.parse(requestBody), grant);
  assert.equal(requestBody.includes(pair.priv), false);
  assert.equal(requestBody.includes(pair.epriv), false);
});

test('clearPrivateFields drops both private fields from the short-lived pair object', () => {
  const pair = { pub: 'pub', epub: 'epub', priv: 'private', epriv: 'encryption-private' };
  clearPrivateFields(pair);
  assert.equal(pair.priv, '');
  assert.equal(pair.epriv, '');
});
