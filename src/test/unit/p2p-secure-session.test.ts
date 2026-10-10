import { webcrypto } from 'node:crypto';
import {
  decryptSecureSessionJson,
  deriveSecureSession,
  encryptSecureSessionJson,
  generateSecureSessionOffer,
  pinnedIdentityAccepts,
} from '../../shared/p2p-secure-session';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

describe('P2P encrypted stranger session', () => {
  async function pair(conversationId = 'conversation-1') {
    const aliceOffer = await generateSecureSessionOffer();
    const bobOffer = await generateSecureSessionOffer();
    const aliceEndpoint = { userId: 'alice', publicKey: 'pub-alice', ...aliceOffer.offer };
    const bobEndpoint = { userId: 'bob', publicKey: 'pub-bob', ...bobOffer.offer };
    const alice = await deriveSecureSession({
      conversationId,
      privateKey: aliceOffer.privateKey,
      local: aliceEndpoint,
      remote: bobEndpoint,
    });
    const bob = await deriveSecureSession({
      conversationId,
      privateKey: bobOffer.privateKey,
      local: bobEndpoint,
      remote: aliceEndpoint,
    });
    return { alice, bob, aliceEndpoint, bobEndpoint, aliceOffer, bobOffer };
  }

  it('derives the same transcript-bound key and hides application data from passive listeners', async () => {
    const { alice, bob } = await pair();
    expect(alice.sessionId).toBe(bob.sessionId);
    const secret = { type: 'mesh', body: 'private Talk answer: meet at noon' };
    const encrypted = await encryptSecureSessionJson(alice.key, alice.sessionId, secret);
    expect(JSON.stringify(encrypted)).not.toContain('meet at noon');
    await expect(decryptSecureSessionJson(bob.key, bob.sessionId, encrypted)).resolves.toEqual(secret);
  });

  it('rejects a MITM key substitution and ciphertext tampering', async () => {
    const { alice, bob, aliceEndpoint } = await pair();
    const attackerOffer = await generateSecureSessionOffer();
    const attacker = await deriveSecureSession({
      conversationId: 'conversation-1',
      privateKey: attackerOffer.privateKey,
      local: { userId: 'mallory', publicKey: 'pub-mallory', ...attackerOffer.offer },
      remote: aliceEndpoint,
    });
    const encrypted = await encryptSecureSessionJson(alice.key, alice.sessionId, { answer: 'yes' });
    await expect(decryptSecureSessionJson(attacker.key, alice.sessionId, encrypted)).rejects.toThrow();
    const changed = `${encrypted.ciphertext.slice(0, -1)}${encrypted.ciphertext.endsWith('A') ? 'B' : 'A'}`;
    await expect(decryptSecureSessionJson(bob.key, bob.sessionId, { ...encrypted, ciphertext: changed })).rejects.toThrow();
  });

  it('makes a captured frame unusable in a fresh session', async () => {
    const first = await pair();
    const captured = await encryptSecureSessionJson(first.alice.key, first.alice.sessionId, { answer: 'captured' });
    const fresh = await pair();
    expect(fresh.bob.sessionId).not.toBe(first.bob.sessionId);
    await expect(decryptSecureSessionJson(fresh.bob.key, fresh.bob.sessionId, captured)).rejects.toThrow();
  });

  it('accepts Unknown peers but fails closed when a Contact key changes', () => {
    expect(pinnedIdentityAccepts(undefined, 'pub-new')).toBe(true);
    expect(pinnedIdentityAccepts('pub-pinned', 'pub-pinned')).toBe(true);
    expect(pinnedIdentityAccepts('pub-pinned', 'pub-replacement')).toBe(false);
  });
});
