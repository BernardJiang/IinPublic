'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const SEA = require('gun/sea');
const {
  fingerprint,
  loadTechSupportPairSync,
  sealPair,
  unsealPair,
  writeJsonAtomicSync,
} = require('../../src/server/security/techsupport-key-custody');
const {
  activateRotation,
  assertTrustAnchorConfig,
  prepareRotation,
  retireRotation,
} = require('../lib/techsupport-key-rotation');

const PASSPHRASE = 'correct horse battery staple';
const PAIR = { pub: 'public', epub: 'encryption-public', priv: 'private-secret', epriv: 'encryption-private-secret' };

test('encrypted vault round-trips without exposing private fields', () => {
  const envelope = sealPair(PAIR, PASSPHRASE, {
    createdAt: '2026-09-18T00:00:00.000Z',
    salt: Buffer.alloc(16, 1),
    iv: Buffer.alloc(12, 2),
  });
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes(PAIR.priv), false);
  assert.equal(serialized.includes(PAIR.epriv), false);
  assert.deepEqual(unsealPair(envelope, PASSPHRASE), PAIR);
  assert.throws(() => unsealPair(envelope, 'this is the wrong passphrase'), /Unable to unlock/);
});

test('vault public metadata is authenticated', () => {
  const envelope = sealPair(PAIR, PASSPHRASE);
  envelope.pub = 'substituted-public-key';
  assert.throws(() => unsealPair(envelope, PASSPHRASE), /Unable to unlock/);
});

test('vault loader rejects private files readable by group or others', { skip: process.platform === 'win32' }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-key-test-'));
  const keyFile = path.join(directory, 'key.json');
  fs.writeFileSync(keyFile, JSON.stringify(sealPair(PAIR, PASSPHRASE)), { mode: 0o644 });
  assert.throws(
    () => loadTechSupportPairSync({ keyFile, passphrase: PASSPHRASE }),
    /permissions 644 allow group\/other access/,
  );
  fs.chmodSync(keyFile, 0o600);
  assert.deepEqual(loadTechSupportPairSync({ keyFile, passphrase: PASSPHRASE }), PAIR);
  fs.rmSync(directory, { recursive: true });
});

test('atomic writer refuses accidental overwrite and creates mode 600 files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-key-write-'));
  const keyFile = path.join(directory, 'key.json');
  writeJsonAtomicSync(keyFile, { test: true });
  if (process.platform !== 'win32') assert.equal(fs.statSync(keyFile).mode & 0o777, 0o600);
  assert.throws(() => writeJsonAtomicSync(keyFile, { changed: true }), /Refusing to overwrite/);
  fs.rmSync(directory, { recursive: true });
});

test('prepare, activate, and retire preserve a safe overlap', () => {
  const initial = {
    version: 1,
    dm: { current: 'old', trusted: ['old'] },
    announcement: { current: 'old', trusted: ['old'] },
  };
  const prepared = prepareRotation(initial, 'new');
  assert.deepEqual(prepared.dm, { current: 'old', trusted: ['old', 'new'] });
  assert.throws(() => activateRotation(initial, 'new'), /Prepare the overlap release/);
  const activated = activateRotation(prepared, 'new');
  assert.deepEqual(activated.announcement, { current: 'new', trusted: ['new', 'old'] });
  assert.throws(() => retireRotation(activated, 'new'), /Cannot retire the current/);
  const retired = retireRotation(activated, 'old');
  assert.deepEqual(retired.dm, { current: 'new', trusted: ['new'] });
  assertTrustAnchorConfig(retired);
});

test('generated SEA pairs survive vault encryption and can still sign', async () => {
  const pair = await SEA.pair();
  const recovered = unsealPair(sealPair(pair, PASSPHRASE), PASSPHRASE);
  const signature = await SEA.sign('custody-check', recovered);
  assert.equal(await SEA.verify(signature, recovered.pub), 'custody-check');
  assert.match(fingerprint(recovered.pub), /^(?:[0-9a-f]{4}:)+[0-9a-f]{4}$/);
});
