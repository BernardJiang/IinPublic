import SEA from 'gun/sea';
import { portableEcdsaSign, portableEcdsaVerify } from '../../shared/portable-ecdsa';

describe('portable-ecdsa — docs/TODO.md Priority 3 (Android embedded-server WebCrypto gap)', () => {
  it('signs and verifies a round trip using a real SEA P-256 pair', async () => {
    const pair = await SEA.pair();
    const signature = await portableEcdsaSign('hello world', pair.priv);
    expect(typeof signature).toBe('string');
    expect(signature.length).toBeGreaterThan(0);
    await expect(portableEcdsaVerify(signature, 'hello world', pair.pub)).resolves.toBe(true);
  });

  it('rejects a signature over a different message (tamper detection)', async () => {
    const pair = await SEA.pair();
    const signature = await portableEcdsaSign('original message', pair.priv);
    await expect(portableEcdsaVerify(signature, 'tampered message', pair.pub)).resolves.toBe(false);
  });

  it('rejects a signature checked against a different signer\'s public key', async () => {
    const signerA = await SEA.pair();
    const signerB = await SEA.pair();
    const signature = await portableEcdsaSign('hello world', signerA.priv);
    await expect(portableEcdsaVerify(signature, 'hello world', signerB.pub)).resolves.toBe(false);
  });

  it('rejects a garbage signature without throwing', async () => {
    const pair = await SEA.pair();
    await expect(portableEcdsaVerify('not-a-real-signature', 'hello world', pair.pub)).resolves.toBe(false);
  });

  it('rejects a malformed public key without throwing', async () => {
    const pair = await SEA.pair();
    const signature = await portableEcdsaSign('hello world', pair.priv);
    await expect(portableEcdsaVerify(signature, 'hello world', 'not-a-real-pub-key')).resolves.toBe(false);
  });

  it('produces different signatures for different pairs signing the same message', async () => {
    const pairA = await SEA.pair();
    const pairB = await SEA.pair();
    const sigA = await portableEcdsaSign('hello world', pairA.priv);
    const sigB = await portableEcdsaSign('hello world', pairB.priv);
    expect(sigA).not.toBe(sigB);
    await expect(portableEcdsaVerify(sigA, 'hello world', pairA.pub)).resolves.toBe(true);
    await expect(portableEcdsaVerify(sigB, 'hello world', pairB.pub)).resolves.toBe(true);
    await expect(portableEcdsaVerify(sigA, 'hello world', pairB.pub)).resolves.toBe(false);
  });
});
