import {
  HandoffCrypto,
  buildEpubAnnouncement,
  verifyEpubAnnouncement,
  buildHandoffEnvelope,
  verifyHandoffEnvelope,
  buildHandoffAck,
  verifyHandoffAck,
  encryptHandoffArchive,
  decryptHandoffArchive,
} from '../../shared/handoff-protocol';
import { buildHandoffArchive, type HandoffArchive } from '../../shared/device-handoff';

/**
 * Deterministic mock crypto. `secret` derives a symmetric value from both sides' epubs
 * (sorted-join, so A.secret(B's epub) === B.secret(A's epub), matching real ECDH's
 * symmetry) — this is what actually exercises "did the protocol pick the right epub for
 * the right peer," not just "does encrypt/decrypt round-trip."
 */
function mockCrypto(pub: string, epub: string): HandoffCrypto {
  return {
    sign: async (data: string) => `sig:${pub}:${data}`,
    verify: async (data: string, sig: string, signerPub: string) => sig === `sig:${signerPub}:${data}`,
    secret: async (peerEpub: string) => [epub, peerEpub].sort().join('+'),
    encrypt: async (plaintext: string, secret: string) => `enc:${secret}:${plaintext}`,
    decrypt: async (ciphertext: string, secret: string) => {
      const prefix = `enc:${secret}:`;
      return ciphertext.startsWith(prefix) ? ciphertext.slice(prefix.length) : undefined;
    },
  };
}

const SENDER_PUB = 'pubSender.key';
const SENDER_EPUB = 'epubSender.key';
const RECEIVER_PUB = 'pubReceiver.key';
const RECEIVER_EPUB = 'epubReceiver.key';
const OTHER_PUB = 'pubOther.key';
const OTHER_EPUB = 'epubOther.key';

const senderCrypto = mockCrypto(SENDER_PUB, SENDER_EPUB);
const receiverCrypto = mockCrypto(RECEIVER_PUB, RECEIVER_EPUB);
// A verify-only crypto usable by either side (verify/no-op sign) — mirrors identity-linking.test.ts's own "shared" crypto.
const verifierCrypto: HandoffCrypto = {
  sign: async () => { throw new Error('verifier does not sign'); },
  verify: async (data, sig, signerPub) => sig === `sig:${signerPub}:${data}`,
  secret: async () => { throw new Error('verifier does not derive secrets'); },
  encrypt: async () => { throw new Error('verifier does not encrypt'); },
  decrypt: async () => { throw new Error('verifier does not decrypt'); },
};

describe('EpubAnnouncement', () => {
  it('builds a signed announcement that verifies against the signer pub', async () => {
    const a = await buildEpubAnnouncement(SENDER_PUB, SENDER_EPUB, senderCrypto, 1000);
    expect(a).toEqual({ pub: SENDER_PUB, epub: SENDER_EPUB, issuedAt: 1000, sig: expect.any(String) });
    expect(await verifyEpubAnnouncement(a, verifierCrypto)).toBe(true);
  });

  it('rejects a tampered epub (signature no longer matches)', async () => {
    const a = await buildEpubAnnouncement(SENDER_PUB, SENDER_EPUB, senderCrypto, 1000);
    const tampered = { ...a, epub: OTHER_EPUB };
    expect(await verifyEpubAnnouncement(tampered, verifierCrypto)).toBe(false);
  });

  it('rejects an announcement claiming a pub it was not signed by', async () => {
    const a = await buildEpubAnnouncement(SENDER_PUB, SENDER_EPUB, senderCrypto, 1000);
    const spoofed = { ...a, pub: OTHER_PUB };
    expect(await verifyEpubAnnouncement(spoofed, verifierCrypto)).toBe(false);
  });
});

describe('HandoffEnvelope', () => {
  it('builds a signed envelope that verifies against fromPub', async () => {
    const e = await buildHandoffEnvelope({
      fromPub: SENDER_PUB, toPub: RECEIVER_PUB, ciphertext: 'ct', crypto: senderCrypto, now: 2000,
    });
    expect(await verifyHandoffEnvelope(e, verifierCrypto)).toBe(true);
  });

  it('rejects a self-addressed envelope', async () => {
    const e = await buildHandoffEnvelope({
      fromPub: SENDER_PUB, toPub: SENDER_PUB, ciphertext: 'ct', crypto: senderCrypto,
    });
    expect(await verifyHandoffEnvelope(e, verifierCrypto)).toBe(false);
  });

  it('rejects a ciphertext swapped in after signing (integrity)', async () => {
    const e = await buildHandoffEnvelope({
      fromPub: SENDER_PUB, toPub: RECEIVER_PUB, ciphertext: 'ct', crypto: senderCrypto,
    });
    const tampered = { ...e, ciphertext: 'different-ct' };
    expect(await verifyHandoffEnvelope(tampered, verifierCrypto)).toBe(false);
  });

  it('rejects a forged fromPub (someone claiming to be the sender)', async () => {
    const e = await buildHandoffEnvelope({
      fromPub: SENDER_PUB, toPub: RECEIVER_PUB, ciphertext: 'ct', crypto: senderCrypto,
    });
    const forged = { ...e, fromPub: OTHER_PUB };
    expect(await verifyHandoffEnvelope(forged, verifierCrypto)).toBe(false);
  });
});

describe('HandoffAck', () => {
  it('builds a signed ack that verifies against fromPub (the receiver, who signs it)', async () => {
    const ack = await buildHandoffAck({ fromPub: RECEIVER_PUB, toPub: SENDER_PUB, crypto: receiverCrypto, now: 3000 });
    expect(await verifyHandoffAck(ack, verifierCrypto)).toBe(true);
  });

  it('rejects a self-addressed ack', async () => {
    const ack = await buildHandoffAck({ fromPub: RECEIVER_PUB, toPub: RECEIVER_PUB, crypto: receiverCrypto });
    expect(await verifyHandoffAck(ack, verifierCrypto)).toBe(false);
  });

  it('the sender cannot forge its own ack — only the receiver possesses the signing key', async () => {
    // A sender attempting to fabricate an ack "from" the receiver produces a signature
    // that fails verification against RECEIVER_PUB, since senderCrypto signs as SENDER_PUB.
    const forged = await buildHandoffAck({ fromPub: RECEIVER_PUB, toPub: SENDER_PUB, crypto: senderCrypto });
    expect(await verifyHandoffAck(forged, verifierCrypto)).toBe(false);
  });
});

describe('encryptHandoffArchive / decryptHandoffArchive (end to end)', () => {
  const archive: HandoffArchive = buildHandoffArchive({
    fromPub: SENDER_PUB,
    now: 5000,
    contacts: [{ id: 'c1', nickname: 'Alice' }],
    myTalks: { t1: { title: 'Selling a bike' } },
  });

  it('round-trips: the receiver decrypts exactly what the sender encrypted', async () => {
    const envelope = await encryptHandoffArchive({
      archive, fromPub: SENDER_PUB, toPub: RECEIVER_PUB, toEpub: RECEIVER_EPUB, crypto: senderCrypto, now: 6000,
    });
    const decrypted = await decryptHandoffArchive(envelope, SENDER_EPUB, receiverCrypto);
    expect(decrypted).toEqual(archive);
  });

  it('a third party who is not the intended receiver cannot decrypt it', async () => {
    const envelope = await encryptHandoffArchive({
      archive, fromPub: SENDER_PUB, toPub: RECEIVER_PUB, toEpub: RECEIVER_EPUB, crypto: senderCrypto,
    });
    const eavesdropperCrypto = mockCrypto(OTHER_PUB, OTHER_EPUB);
    // The eavesdropper derives a *different* secret (their own epub, not the receiver's),
    // so decrypting with the sender's real epub still fails.
    const decrypted = await decryptHandoffArchive(envelope, SENDER_EPUB, eavesdropperCrypto);
    expect(decrypted).toBeNull();
  });

  it('rejects an envelope whose signature does not verify', async () => {
    const envelope = await encryptHandoffArchive({
      archive, fromPub: SENDER_PUB, toPub: RECEIVER_PUB, toEpub: RECEIVER_EPUB, crypto: senderCrypto,
    });
    const tampered = { ...envelope, ciphertext: envelope.ciphertext + 'x' };
    expect(await decryptHandoffArchive(tampered, SENDER_EPUB, receiverCrypto)).toBeNull();
  });

  it('rejects a decrypted payload whose embedded fromPub does not match the envelope (cross-binding)', async () => {
    // Simulate a relay swapping in a differently-addressed archive's ciphertext but
    // keeping the outer envelope's fromPub/sig — the embedded archive.fromPub mismatch
    // is the last line of defense.
    const otherArchive = buildHandoffArchive({ fromPub: OTHER_PUB, now: 7000 });
    const secret = await senderCrypto.secret(RECEIVER_EPUB);
    const swappedCiphertext = await senderCrypto.encrypt(JSON.stringify(otherArchive), secret);
    const envelope = await buildHandoffEnvelope({
      fromPub: SENDER_PUB, toPub: RECEIVER_PUB, ciphertext: swappedCiphertext, crypto: senderCrypto,
    });
    expect(await decryptHandoffArchive(envelope, SENDER_EPUB, receiverCrypto)).toBeNull();
  });
});
