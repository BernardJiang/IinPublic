import SEA from 'gun/sea';
import { createSignedP2PEnvelopeProof, verifySignedP2PEnvelopeProof } from '../../shared/p2p-runtime';
import { p2pMeshFrameSigningPayload, type P2PMeshFrame } from '../../shared/p2p-mesh-protocol';

describe('malicious intermediary security boundary', () => {
  test('a forwarder cannot alter original SEA-authored content', async () => {
    const alice = await SEA.pair();
    const unsigned: P2PMeshFrame = {
      version: 1, kind: 'talk-announce', msgId: 'talk-1', roomId: 'global',
      originUserId: 'alice', originPub: alice.pub, recipientUserId: 'bob',
      createdAt: '2026-08-12T00:00:00.000Z', ttlHops: 3,
      payload: { talkId: 'talk-1', authorId: 'alice', authorName: 'Alice', title: 'Original', questionCount: 1 },
    };
    const proof = await createSignedP2PEnvelopeProof({ pair: alice, payload: p2pMeshFrameSigningPayload(unsigned), timestamp: unsigned.createdAt, nonce: 'intermediary-vector' });
    const forwarded = { ...unsigned, ttlHops: 2, proof };
    await expect(verifySignedP2PEnvelopeProof({ proof, payload: p2pMeshFrameSigningPayload(forwarded), now: new Date('2026-08-12T00:00:01.000Z') })).resolves.toEqual({ ok: true });
    const altered = { ...forwarded, payload: { ...forwarded.payload, title: 'Altered by relay' } };
    await expect(verifySignedP2PEnvelopeProof({ proof, payload: p2pMeshFrameSigningPayload(altered), now: new Date('2026-08-12T00:00:01.000Z') })).resolves.toEqual({ ok: false, reason: 'payload hash mismatch' });
  });

  test('an intermediary SEA key cannot decrypt pair-private mailbox content', async () => {
    const [alice, bob, mallory] = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]);
    const aliceBobSecret = await SEA.secret(bob.epub, alice);
    if (!aliceBobSecret) throw new Error('failed to derive Alice/Bob test secret');
    const ciphertext = await SEA.encrypt(JSON.stringify({ answer: 'private' }), aliceBobSecret);
    const bobAliceSecret = await SEA.secret(alice.epub, bob);
    if (!bobAliceSecret) throw new Error('failed to derive Bob/Alice test secret');
    expect(await SEA.decrypt(ciphertext, bobAliceSecret)).toEqual({ answer: 'private' });
    const mallorySecret = await SEA.secret(alice.epub, mallory);
    if (!mallorySecret) throw new Error('failed to derive Mallory test secret');
    await expect(SEA.decrypt(ciphertext, mallorySecret)).resolves.toBeUndefined();
    expect(JSON.stringify(ciphertext)).not.toContain('private');
  });
});
