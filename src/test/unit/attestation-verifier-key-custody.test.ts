import fs from 'fs';
import os from 'os';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const keyCustody = require('../../server/security/attestation-verifier-key-custody');

describe('attestation-verifier-key-custody', () => {
  const passphrase = 'a-sufficiently-long-test-passphrase';

  it('generates a P-256 EC keypair in the expected shape', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    expect(pair.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(pair.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('seals and unseals a keypair round-trip', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const envelope = keyCustody.sealPair(pair, passphrase);
    expect(envelope.format).toBe(keyCustody.KEY_FORMAT);
    expect(envelope.publicKeyPem).toBe(pair.publicKeyPem);
    const recovered = keyCustody.unsealPair(envelope, passphrase);
    expect(recovered.publicKeyPem).toBe(pair.publicKeyPem);
    expect(recovered.privateKeyPem).toBe(pair.privateKeyPem);
  });

  it('rejects unsealing with the wrong passphrase', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const envelope = keyCustody.sealPair(pair, passphrase);
    expect(() => keyCustody.unsealPair(envelope, 'a-different-long-enough-passphrase')).toThrow(
      /Unable to unlock/,
    );
  });

  it('rejects a tampered ciphertext (AEAD tag integrity)', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const envelope = keyCustody.sealPair(pair, passphrase);
    const tampered = { ...envelope, cipher: { ...envelope.cipher, ciphertext: Buffer.from('tampered').toString('base64') } };
    expect(() => keyCustody.unsealPair(tampered, passphrase)).toThrow(/Unable to unlock/);
  });

  it('rejects a passphrase shorter than 16 characters', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    expect(() => keyCustody.sealPair(pair, 'short')).toThrow(/at least 16 characters/);
  });

  it('signs and verifies data with the keypair', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const data = JSON.stringify({ hello: 'world' });
    const signature = keyCustody.signWithVerifierKey(pair.privateKeyPem, data);
    expect(keyCustody.verifyWithVerifierKey(pair.publicKeyPem, data, signature)).toBe(true);
  });

  it('rejects a signature verified against different data (tampered payload)', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const signature = keyCustody.signWithVerifierKey(pair.privateKeyPem, 'original');
    expect(keyCustody.verifyWithVerifierKey(pair.publicKeyPem, 'tampered', signature)).toBe(false);
  });

  it('rejects a signature verified against a different key', () => {
    const pairA = keyCustody.generateVerifierKeyPair();
    const pairB = keyCustody.generateVerifierKeyPair();
    const signature = keyCustody.signWithVerifierKey(pairA.privateKeyPem, 'data');
    expect(keyCustody.verifyWithVerifierKey(pairB.publicKeyPem, 'data', signature)).toBe(false);
  });

  it('never throws on a malformed signature — degrades to false', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    expect(keyCustody.verifyWithVerifierKey(pair.publicKeyPem, 'data', 'not-valid-base64-der!!!')).toBe(false);
  });

  it('produces a stable, colon-grouped fingerprint for the same public key', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const fp1 = keyCustody.fingerprint(pair.publicKeyPem);
    const fp2 = keyCustody.fingerprint(pair.publicKeyPem);
    expect(fp1).toBe(fp2);
    expect(fp1).toMatch(/^([0-9a-f]{4}:)+[0-9a-f]{4}$/);
  });

  describe('filesystem round-trip', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-attestation-key-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes an encrypted vault to disk with 0600 permissions and loads it back', () => {
      const pair = keyCustody.generateVerifierKeyPair();
      const envelope = keyCustody.sealPair(pair, passphrase);
      const vaultPath = path.join(dir, 'attestation-verifier.key.json');
      keyCustody.writeJsonAtomicSync(vaultPath, envelope);

      if (process.platform !== 'win32') {
        const mode = fs.statSync(vaultPath).mode & 0o777;
        expect(mode).toBe(0o600);
      }

      const loaded = keyCustody.loadVerifierPairSync({
        keyFile: vaultPath,
        passphrase,
        env: {},
      });
      expect(loaded.publicKeyPem).toBe(pair.publicKeyPem);
    });

    it('refuses to read a vault/passphrase file with group/other-readable permissions', () => {
      if (process.platform === 'win32') return; // permission bits are POSIX-only
      const pair = keyCustody.generateVerifierKeyPair();
      const envelope = keyCustody.sealPair(pair, passphrase);
      const vaultPath = path.join(dir, 'attestation-verifier.key.json');
      keyCustody.writeJsonAtomicSync(vaultPath, envelope);
      fs.chmodSync(vaultPath, 0o644);

      expect(() =>
        keyCustody.loadVerifierPairSync({ keyFile: vaultPath, passphrase, env: {} }),
      ).toThrow(/Refusing to read private key material/);
    });

    it('inspectVaultFileSync reports public metadata without the private key', () => {
      const pair = keyCustody.generateVerifierKeyPair();
      const envelope = keyCustody.sealPair(pair, passphrase);
      const vaultPath = path.join(dir, 'attestation-verifier.key.json');
      keyCustody.writeJsonAtomicSync(vaultPath, envelope);

      const inspected = keyCustody.inspectVaultFileSync(vaultPath);
      expect(inspected.publicKeyPem).toBe(pair.publicKeyPem);
      expect(inspected.fingerprint).toBe(keyCustody.fingerprint(pair.publicKeyPem));
      expect(JSON.stringify(inspected)).not.toContain('BEGIN PRIVATE KEY');
    });

    it('refuses to overwrite an existing file without force', () => {
      const vaultPath = path.join(dir, 'attestation-verifier.key.json');
      keyCustody.writeJsonAtomicSync(vaultPath, { a: 1 });
      expect(() => keyCustody.writeJsonAtomicSync(vaultPath, { a: 2 })).toThrow(/Refusing to overwrite/);
    });
  });
});
