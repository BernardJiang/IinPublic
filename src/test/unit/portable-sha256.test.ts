import { portableSha256Hex } from '../../shared/portable-sha256';

describe('portableSha256Hex', () => {
  it('matches the SHA-256 known-answer vector without relying on global WebCrypto', () => {
    expect(portableSha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
