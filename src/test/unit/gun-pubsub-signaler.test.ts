import SEA from 'gun/sea';
import {
  GunPubSubSignaler,
  deriveSignalingSharedKey,
} from '../../web/services/gun-pubsub-signaler';
import {
  encodeSignalingPayload,
  type PostSignalingBody,
} from '../../web/services/p2p-signaling-client';
import {
  createSignedP2PEnvelopeProof,
  derivePeerIdFromPub,
  p2pSignalingSigningPayload,
  type P2PSignalingEnvelope,
} from '../../shared/p2p-runtime';

/**
 * Minimal in-memory Gun stand-in supporting the access pattern the signaler uses:
 *   post:      gun.get('p2p-signal').get(key).get(nonce).put(string)
 *   subscribe: gun.get('p2p-signal').get(key).map().on(cb)  // fires per child value
 */
class FakeGunNode {
  value: unknown = undefined;
  private children = new Map<string, FakeGunNode>();
  private mapSubs = new Set<(value: unknown, key: string) => void>();
  private parent: FakeGunNode | null = null;
  private keyInParent = '';

  get(key: string): FakeGunNode {
    let child = this.children.get(key);
    if (!child) {
      child = new FakeGunNode();
      child.parent = this;
      child.keyInParent = key;
      this.children.set(key, child);
    }
    return child;
  }

  put(value: unknown): void {
    this.value = value;
    if (this.parent) {
      for (const sub of this.parent.mapSubs) sub(value, this.keyInParent);
    }
  }

  once(cb: (value: unknown, key: string) => void): FakeGunNode {
    cb(this.value, this.keyInParent);
    return this;
  }

  map(): { on: (cb: (value: unknown, key: string) => void) => { off: () => void } } {
    return {
      on: (cb) => {
        // Emit already-present children, then subscribe to future puts.
        for (const [k, child] of this.children) {
          if (child.value !== undefined) cb(child.value, k);
        }
        this.mapSubs.add(cb);
        return { off: () => this.mapSubs.delete(cb) };
      },
    };
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type SeaPair = Awaited<ReturnType<typeof SEA.pair>>;

async function buildSignedBody(params: {
  pair: SeaPair;
  conversationId: string;
  recipientPub: string;
  payload: unknown;
}): Promise<PostSignalingBody> {
  const signalCiphertext = encodeSignalingPayload(params.payload);
  const signingPayload = p2pSignalingSigningPayload({
    conversationId: params.conversationId,
    kind: 'offer',
    senderPub: params.pair.pub,
    recipientPub: params.recipientPub,
    signalCiphertext,
  });
  const proof = await createSignedP2PEnvelopeProof({
    pair: params.pair,
    payload: signingPayload,
  });
  return {
    kind: 'offer',
    senderPeerId: proof.peerId,
    senderPub: params.pair.pub,
    recipientPub: params.recipientPub,
    signalCiphertext,
    timestamp: proof.timestamp,
    payloadHash: proof.payloadHash,
    signature: proof.signature,
    nonce: proof.nonce,
  };
}

describe('deriveSignalingSharedKey', () => {
  it('is a 64-hex SHA-256 digest', async () => {
    const key = await deriveSignalingSharedKey('pubA', 'pubB');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic and order-independent (symmetric)', async () => {
    const ab = await deriveSignalingSharedKey('pubA', 'pubB');
    const ba = await deriveSignalingSharedKey('pubB', 'pubA');
    expect(ab).toBe(ba);
    expect(await deriveSignalingSharedKey('pubA', 'pubB')).toBe(ab);
  });

  it('differs for different peer pairs', async () => {
    const ab = await deriveSignalingSharedKey('pubA', 'pubB');
    const ac = await deriveSignalingSharedKey('pubA', 'pubC');
    expect(ab).not.toBe(ac);
  });
});

describe('GunPubSubSignaler', () => {
  it('writes a frame record (object node) keyed by nonce under p2p-signal/sharedKey', async () => {
    const gun = new FakeGunNode();
    const signaler = new GunPubSubSignaler(gun, 'localPub', 'otherPub');
    const sharedKey = await deriveSignalingSharedKey('localPub', 'otherPub');

    const body: PostSignalingBody = {
      kind: 'offer',
      senderPeerId: 'peer_x',
      senderPub: 'localPub',
      recipientPub: 'otherPub',
      signalCiphertext: encodeSignalingPayload({ type: 'offer' }),
      timestamp: new Date().toISOString(),
      payloadHash: 'hash',
      signature: 'sig',
      nonce: 'nonce-123',
    };
    await signaler.post('conv1', body);

    const stored = gun.get('p2p-signal').get(sharedKey).get('nonce-123').value;
    expect(typeof stored).toBe('object');
    expect(stored).toMatchObject({
      conversationId: 'conv1',
      kind: 'offer',
      senderPub: 'localPub',
      nonce: 'nonce-123',
    });
  });

  it('delivers a valid signed frame from the peer to onEnvelope', async () => {
    const gun = new FakeGunNode();
    const localPair = await SEA.pair();
    const remotePair = await SEA.pair();

    const received: Array<{ envelope: P2PSignalingEnvelope; payload: unknown }> = [];
    const local = new GunPubSubSignaler(gun, localPair.pub, remotePair.pub);
    const stop = local.startPolling('conv1', localPair.pub, (envelope, payload) => {
      received.push({ envelope, payload });
    });
    await flush();

    const remote = new GunPubSubSignaler(gun, remotePair.pub, localPair.pub);
    const body = await buildSignedBody({
      pair: remotePair,
      conversationId: 'conv1',
      recipientPub: localPair.pub,
      payload: { type: 'offer', sdp: 'v=0' },
    });
    await remote.post('conv1', body);
    await flush();
    await flush();

    expect(received).toHaveLength(1);
    expect(received[0].payload).toEqual({ type: 'offer', sdp: 'v=0' });
    expect(received[0].envelope.senderPeerId).toBe(await derivePeerIdFromPub(remotePair.pub));
    stop();
  });

  it('ignores frames it sent itself and de-dupes repeated nonces', async () => {
    const gun = new FakeGunNode();
    const localPair = await SEA.pair();
    const remotePair = await SEA.pair();

    let count = 0;
    const local = new GunPubSubSignaler(gun, localPair.pub, remotePair.pub);
    const stop = local.startPolling('conv1', localPair.pub, () => {
      count += 1;
    });
    await flush();

    // A frame authored locally must never be echoed back to its own handler.
    const localBody = await buildSignedBody({
      pair: localPair,
      conversationId: 'conv1',
      recipientPub: remotePair.pub,
      payload: { type: 'offer' },
    });
    await local.post('conv1', localBody);
    await flush();
    await flush();
    expect(count).toBe(0);

    // A remote frame is delivered once; re-putting the same nonce is suppressed.
    const remote = new GunPubSubSignaler(gun, remotePair.pub, localPair.pub);
    const remoteBody = await buildSignedBody({
      pair: remotePair,
      conversationId: 'conv1',
      recipientPub: localPair.pub,
      payload: { type: 'answer' },
    });
    await remote.post('conv1', remoteBody);
    await flush();
    await flush();
    expect(count).toBe(1);

    await remote.post('conv1', remoteBody);
    await flush();
    await flush();
    expect(count).toBe(1);
    stop();
  });
});
