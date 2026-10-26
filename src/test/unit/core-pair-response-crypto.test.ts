/** OPEN-91 P4: pair-private Talk responses, through real SEA. */
import SEA from 'gun/sea';
import { decodePairResponse, encryptPairResponse, firstKeyHint, type SeaPort } from '../../core/pair-response-crypto';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

const sea: SeaPort = {
  secret: (epub, pair) => (SEA as any).secret(epub, pair),
  encrypt: (data, secret) => (SEA as any).encrypt(data, secret),
  decrypt: (data, secret) => (SEA as any).decrypt(data, secret),
};

describe('pair response crypto', () => {
  let bob: SeaSigningPair; let ann: SeaSigningPair;
  beforeAll(async () => { [bob, ann] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[]; });

  it('only the author decrypts what the responder encrypted for them; the inline key is remembered', async () => {
    const content = { responderName: 'Bob', authorName: 'Ann', answers: [{ questionId: 'q1', answerId: 'yes' }], isChatbotResponse: true };
    const payloadCiphertext = await encryptPairResponse(sea, bob, 'ann', (ann as any).epub, content);
    const remembered: string[] = [];
    const decoded = await decodePairResponse(sea, ann, { responderId: 'bob', responderEpub: (bob as any).epub, payloadCiphertext },
      async (_id, hint) => hint, (id) => remembered.push(id));
    expect(decoded).toEqual(content);
    expect(remembered).toEqual(['bob']);
  });

  it('reads a legacy plaintext response, answers given as JSON text', async () => {
    const decoded = await decodePairResponse(sea, ann, { responderId: 'bob', answers: '[{"questionId":"q1"}]' }, async () => null);
    expect(decoded).toEqual({ responderName: 'bob', authorName: 'Unknown', answers: [{ questionId: 'q1' }], isChatbotResponse: false });
  });

  it('refuses without my keypair or the peer’s key', async () => {
    await expect(encryptPairResponse(sea, null, 'ann', 'epub', {})).rejects.toThrow('No SEA keypair');
    await expect(encryptPairResponse(sea, bob, 'ann', undefined, {})).rejects.toThrow('no public encryption key');
    expect(firstKeyHint(undefined, ' ', ' k ')).toBe('k');
  });
});
