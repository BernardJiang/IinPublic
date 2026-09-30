import { verifyOfficialBuildCredentialSignature } from '../../shared/official-build-credential-signature';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const keyCustody = require('../../server/security/attestation-verifier-key-custody');

describe('verifyOfficialBuildCredentialSignature', () => {
  it('verifies a signature produced by the real server-side signing pipeline (cross-compatibility)', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const data = 'schemaVersion=1|credentialId=cred_1|applicationId=com.iinpublic.app';
    const signature = keyCustody.signWithVerifierKey(pair.privateKeyPem, data);
    expect(verifyOfficialBuildCredentialSignature(pair.publicKeyPem, data, signature)).toBe(true);
  });

  it('rejects when the data does not match (tampered credential)', () => {
    const pair = keyCustody.generateVerifierKeyPair();
    const signature = keyCustody.signWithVerifierKey(pair.privateKeyPem, 'original');
    expect(verifyOfficialBuildCredentialSignature(pair.publicKeyPem, 'tampered', signature)).toBe(false);
  });

  it('rejects when verified against a different key', () => {
    const pairA = keyCustody.generateVerifierKeyPair();
    const pairB = keyCustody.generateVerifierKeyPair();
    const signature = keyCustody.signWithVerifierKey(pairA.privateKeyPem, 'data');
    expect(verifyOfficialBuildCredentialSignature(pairB.publicKeyPem, 'data', signature)).toBe(false);
  });

  it('never throws on garbage input — degrades to false', () => {
    expect(verifyOfficialBuildCredentialSignature('not a pem', 'data', 'not-base64!!!')).toBe(false);
    expect(verifyOfficialBuildCredentialSignature('', '', '')).toBe(false);
  });

  it('rejects a well-formed but wrong-length SPKI (not actually P-256)', () => {
    const fakePem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from('too short').toString('base64')}\n-----END PUBLIC KEY-----`;
    expect(verifyOfficialBuildCredentialSignature(fakePem, 'data', 'AAAA')).toBe(false);
  });

  it('round-trips for many independently generated keypairs (not a fluke of one key)', () => {
    for (let i = 0; i < 5; i += 1) {
      const pair = keyCustody.generateVerifierKeyPair();
      const data = `iteration=${i}`;
      const signature = keyCustody.signWithVerifierKey(pair.privateKeyPem, data);
      expect(verifyOfficialBuildCredentialSignature(pair.publicKeyPem, data, signature)).toBe(true);
    }
  });
});
