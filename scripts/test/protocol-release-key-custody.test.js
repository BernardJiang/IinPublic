'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const SEA = require('gun/sea');
const custody = require('../../src/server/security/protocol-release-key-custody');

test('protocol-release custody round-trips a dedicated sequence-bound encrypted vault', async () => {
  const pair = await SEA.pair();
  const passphrase = 'correct horse battery staple protocol';
  const envelope = custody.sealPair(pair, passphrase, {
    sequence: 3,
    createdAt: '2026-10-12T00:00:00.000Z',
    salt: Buffer.alloc(16, 1),
    iv: Buffer.alloc(12, 2),
  });
  assert.equal(envelope.format, custody.KEY_FORMAT);
  assert.equal(envelope.role, 'protocol-manifest-signing');
  assert.equal(envelope.sequence, 3);
  assert.equal(envelope.priv, undefined);
  assert.equal(envelope.epriv, undefined);
  assert.deepEqual(custody.unsealPair(envelope, passphrase), pair);
  assert.throws(() => custody.unsealPair(envelope, 'wrong passphrase that is long enough'), /Unable to unlock/);
});
test('protocol-release custody refuses invalid sequences and TechSupport-format envelopes', async () => {
  const pair = await SEA.pair();
  assert.throws(() => custody.sealPair(pair, 'a'.repeat(20), { sequence: 1 }), /at least 2/);
  assert.throws(
    () => custody.assertEnvelopeShape({ format: 'iinpublic-techsupport-key-v1', version: 1 }),
    /not a supported IinPublic protocol release/,
  );
});

test('protocol-release vault and passphrase files are written mode 600 and inspected without decryption', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-protocol-key-'));
  const vaultPath = path.join(directory, 'k3.json');
  const passphrasePath = path.join(directory, 'k3.passphrase');
  const passphrase = 'b'.repeat(32);
  const pair = await SEA.pair();
  try {
    custody.writePassphraseAtomicSync(passphrasePath, passphrase);
    custody.writeJsonAtomicSync(vaultPath, custody.sealPair(pair, passphrase, { sequence: 3 }));
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(vaultPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(passphrasePath).mode & 0o777, 0o600);
    }
    const metadata = custody.inspectVaultFileSync(vaultPath);
    assert.equal(metadata.sequence, 3);
    assert.equal(metadata.pub, pair.pub);
    assert.equal(metadata.cipher.ciphertext, undefined);
    assert.deepEqual(
      custody.loadProtocolReleasePairSync({ keyFile: vaultPath, passphrase }),
      pair,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
