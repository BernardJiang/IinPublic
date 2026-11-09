import SEA from 'gun/sea';
import { p256 } from '@noble/curves/p256';
import { portableEcdsaSign, portableEcdsaVerify, setPortableEcdsaWebCryptoForTests } from '../../shared/portable-ecdsa';

describe.each([
  ['WebCrypto', true],
  ['pure JS (embedded server)', false],
])('portable-ecdsa via %s — docs/TODO.md Priority 3 (Android embedded-server WebCrypto gap)', (_name, webCrypto) => {
  beforeEach(() => setPortableEcdsaWebCryptoForTests(webCrypto));
  afterAll(() => setPortableEcdsaWebCryptoForTests(true));

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

describe('portable-ecdsa — WebCrypto and pure-JS signatures are interchangeable (Honor FRD start-up freeze, 2026-11-09)', () => {
  afterEach(() => setPortableEcdsaWebCryptoForTests(true));

  it('a signature made by either path verifies on the other, including high-S WebCrypto signatures', async () => {
    const pair = await SEA.pair();
    let highS = 0;
    for (let i = 0; i < 40; i += 1) {
      const message = `envelope ${i}`;
      setPortableEcdsaWebCryptoForTests(true);
      const native = await portableEcdsaSign(message, pair.priv);
      if (isHighS(native)) highS += 1;
      setPortableEcdsaWebCryptoForTests(false);
      const pure = await portableEcdsaSign(message, pair.priv);
      await expect(portableEcdsaVerify(native, message, pair.pub)).resolves.toBe(true);
      await expect(portableEcdsaVerify(pure, message, pair.pub)).resolves.toBe(true);
      await expect(portableEcdsaVerify(native, `${message}!`, pair.pub)).resolves.toBe(false);
      setPortableEcdsaWebCryptoForTests(true);
      await expect(portableEcdsaVerify(pure, message, pair.pub)).resolves.toBe(true);
      await expect(portableEcdsaVerify(native, message, pair.pub)).resolves.toBe(true);
      await expect(portableEcdsaVerify(pure, `${message}!`, pair.pub)).resolves.toBe(false);
    }
    expect(highS).toBeGreaterThan(0);
  });

});

function isHighS(signature: string): boolean {
  const bytes = Uint8Array.from(Buffer.from(signature, 'base64url'));
  const s = BigInt(`0x${Buffer.from(bytes.slice(32)).toString('hex')}`);
  return s > p256.CURVE.n / 2n;
}
