'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  assertPublicHistory,
  extensionsOption,
  listOption,
  parseOptions,
  verifyProduction,
} = require('../protocol-manifest-tool');

test('protocol manifest tool parses explicit sequence/key paths without accepting private CLI values', () => {
  assert.deepEqual(
    parseOptions([
      'append', '--expected-sequence', '3', '--signing-key', 'k3.json',
      '--signing-passphrase-file', 'k3.passphrase', '--next-key', 'k4.json',
      '--effective-at', '2026-12-01T00:00:00.000Z', '--force',
    ]),
    {
      _: ['append'],
      'expected-sequence': '3',
      'signing-key': 'k3.json',
      'signing-passphrase-file': 'k3.passphrase',
      'next-key': 'k4.json',
      'effective-at': '2026-12-01T00:00:00.000Z',
      force: true,
    },
  );
});

test('protocol manifest tool rejects duplicate capabilities and private fields in public history', () => {
  assert.throws(
    () => listOption({ capabilities: 'one,one' }, 'capabilities', []),
    /duplicates/,
  );
  assert.throws(
    () => assertPublicHistory([{ body: {}, priv: 'must-not-ship' }]),
    /Private field priv/,
  );
  assert.doesNotThrow(() => assertPublicHistory([{ body: { nextReleaseKeys: [{ publicKey: 'public' }] } }]));
});

test('production gate requires a verified bridge and a dedicated successor key', async () => {
  const legacy = 'legacy-announcement-public-key';
  const recovery = 'recovery-public-key';
  const dedicated = 'dedicated-k3-public-key';
  const modules = {
    production: {
      PRODUCTION_PROTOCOL_MANIFEST_ANCHOR: {
        nextReleaseKeys: [{ publicKey: legacy }],
        recoveryPolicy: { keys: [{ publicKey: recovery }] },
      },
      PRODUCTION_PROTOCOL_MANIFEST_RUNTIME: {},
    },
    protocol: {
      verifyProtocolManifestChain: async ({ manifests }) => ({
        ok: true,
        state: {
          sequence: manifests.length + 1,
          nextReleaseKeys: [{ publicKey: manifests[0]?.body?.nextReleaseKeys?.[0]?.publicKey || legacy }],
        },
      }),
    },
  };
  await assert.rejects(
    verifyProduction({}, { modules, history: [] }),
    /has not bridged/,
  );
  await verifyProduction({}, {
    modules,
    history: [{ body: {
      nextReleaseKeys: [{ publicKey: dedicated }],
      recoveryPolicy: { keys: [{ publicKey: recovery }] },
    } }],
  });
  await assert.rejects(
    verifyProduction({}, {
      modules,
      history: [{ body: {
        nextReleaseKeys: [{ publicKey: legacy }],
        recoveryPolicy: { keys: [{ publicKey: recovery }] },
      } }],
    }),
    /reuses an ordinary release key/,
  );
});

test('extensions carry forward and an extensions file replaces entries by name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-ext-'));
  const file = path.join(dir, 'ext.json');
  fs.writeFileSync(file, JSON.stringify({ 'nearby-v3': { attestorKeys: [{ keyId: 'k', publicKey: 'p' }] } }));
  assert.deepEqual(
    extensionsOption({ 'extensions-file': file }, { other: { a: 1 }, 'nearby-v3': { old: true } }),
    { other: { a: 1 }, 'nearby-v3': { attestorKeys: [{ keyId: 'k', publicKey: 'p' }] } },
  );
  assert.deepEqual(extensionsOption({}, { other: { a: 1 } }), { other: { a: 1 } });
  assert.equal(extensionsOption({}, undefined), undefined);
  fs.writeFileSync(file, JSON.stringify({ x: { priv: 'secret' } }));
  assert.throws(() => extensionsOption({ 'extensions-file': file }, undefined), /Private field priv/);
});
