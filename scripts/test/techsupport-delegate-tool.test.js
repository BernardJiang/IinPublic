'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  approve,
  clearPrivateFields,
  invite,
  issue,
  loadEncryptedOperatorPair,
  normalizeApiBase,
  parseOptions,
  parsePollTimeoutSeconds,
  parseTtlDays,
} = require('../techsupport-delegate-tool');
const {
  createDelegateInvite,
  delegateRequestMatchesInvite,
  encodeDelegateInviteCode,
  verifyDelegateRequest,
} = require('../../dist/server/shared/techsupport-delegate-invite');

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

test('parsePollTimeoutSeconds accepts a positive integer override and rejects anything else', () => {
  assert.equal(parsePollTimeoutSeconds(undefined, 42), 42);
  assert.equal(parsePollTimeoutSeconds('90', 42), 90);
  assert.throws(() => parsePollTimeoutSeconds('0', 42), /positive integer/);
  assert.throws(() => parsePollTimeoutSeconds('abc', 42), /positive integer/);
});

test('invite never signs or publishes — it only prints the code and, on a match, the candidate + next command', async () => {
  const inviteModule = { createDelegateInvite, encodeDelegateInviteCode, verifyDelegateRequest, delegateRequestMatchesInvite };
  const SEA = require('gun/sea');
  const candidate = await SEA.pair();

  let capturedPayload;
  const originalCreate = inviteModule.createDelegateInvite;
  inviteModule.createDelegateInvite = (randomSecret) => {
    capturedPayload = originalCreate(randomSecret);
    return capturedPayload;
  };

  const { buildDelegateRequest } = require('../../dist/server/shared/techsupport-delegate-invite');
  let requestCallCount = 0;
  const request = async () => {
    requestCallCount += 1;
    if (requestCallCount < 2) return null; // not arrived yet on the first poll
    return buildDelegateRequest(
      { requestId: capturedPayload.requestId, secret: capturedPayload.secret, candidateUserId: 'candidate-user' },
      candidate,
    );
  };

  const result = await invite({ 'poll-timeout-seconds': '30' }, inviteModule, 'https://www.iinpublic.com', request);
  assert.ok(result.code);
  assert.ok(result.matched);
  assert.equal(result.matched.candidatePub, candidate.pub);
  assert.equal(result.matched.candidateUserId, 'candidate-user');
  assert.ok(requestCallCount >= 2);
});

test('invite --dry-run prints the code without ever polling', async () => {
  const inviteModule = { createDelegateInvite, encodeDelegateInviteCode, verifyDelegateRequest, delegateRequestMatchesInvite };
  let requestCalled = false;
  const request = async () => { requestCalled = true; return null; };
  const result = await invite({ dryRun: true }, inviteModule, 'https://www.iinpublic.com', request);
  assert.ok(result.code);
  assert.equal(result.matched, null);
  assert.equal(requestCalled, false);
});

test('invite gives up and returns unmatched once the poll timeout elapses with no request', async () => {
  const inviteModule = { createDelegateInvite, encodeDelegateInviteCode, verifyDelegateRequest, delegateRequestMatchesInvite };
  const request = async () => null; // never arrives
  const result = await invite({ 'poll-timeout-seconds': '1' }, inviteModule, 'https://www.iinpublic.com', request);
  assert.equal(result.matched, null);
});

test('approve re-verifies the specific pending request by id, then signs and publishes an ordinary grant for its candidate', async () => {
  const SEA = require('gun/sea');
  const candidate = await SEA.pair();
  const { buildDelegateRequest } = require('../../dist/server/shared/techsupport-delegate-invite');
  const pendingRequest = await buildDelegateRequest(
    { requestId: 'req-1', secret: 'secret-1', candidateUserId: 'candidate-user' },
    candidate,
  );

  const pair = { pub: 'root-pub', epub: 'root-epub', priv: 'root-private', epriv: 'root-eprivate' };
  const grant = {
    delegatePub: candidate.pub,
    delegateUserId: 'candidate-user',
    label: 'Support phone',
    issuedAt: '2026-09-24T00:00:00.000Z',
    expiresAt: '2026-10-24T00:00:00.000Z',
    revokedAt: null,
    masterPub: pair.pub,
    signature: 'root-signature',
  };
  const delegates = {
    signDelegateGrant: async (input, signer) => {
      assert.equal(signer, pair);
      assert.equal(input.delegatePub, candidate.pub);
      assert.equal(input.delegateUserId, 'candidate-user');
      return grant;
    },
  };
  const inviteModule = { verifyDelegateRequest };

  let requestedUrl = '';
  let published = null;
  const request = async (url, options) => {
    if (!options) {
      requestedUrl = url;
      return pendingRequest;
    }
    published = JSON.parse(options.body);
    return { stored: true };
  };

  const result = await approve(
    { 'request-id': 'req-1', label: 'Support phone' },
    pair,
    delegates,
    inviteModule,
    'https://www.iinpublic.com',
    request,
  );

  assert.ok(requestedUrl.endsWith('/api/support/delegate-requests/req-1'));
  assert.equal(result, grant);
  assert.deepEqual(published, grant);
});

test('approve refuses a request id with nothing verifiable behind it', async () => {
  const inviteModule = { verifyDelegateRequest };
  const request = async () => null;
  await assert.rejects(
    () => approve({ 'request-id': 'missing', label: 'x' }, { pub: 'p' }, {}, inviteModule, 'https://www.iinpublic.com', request),
    /No verifiable pending request/,
  );
});
