import SEA from 'gun/sea';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import type { P2PMeshFrame, P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import { p2pMeshFrameSigningPayload } from '../../shared/p2p-mesh-protocol';
import { createSignedP2PEnvelopeProof } from '../../shared/p2p-runtime';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { WebGunService } from '../../web/services/web-gun-service';

type FakeSessionRecord = {
  localUserId: string;
  hook?: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
};

function createFakeNetwork(opts: {
  hangSend?: (params: { localUserId: string; otherUserId: string }) => boolean;
} = {}) {
  const sessions = new Map<string, FakeSessionRecord[]>();
  return {
    createSession(params: {
      conversationId: string;
      localUserId: string;
      otherUserId: string;
      onRemoteMeshFrame: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
    }) {
      const records = sessions.get(params.conversationId) || [];
      const record: FakeSessionRecord = {
        localUserId: params.localUserId,
        hook: params.onRemoteMeshFrame,
      };
      records.push(record);
      sessions.set(params.conversationId, records);
      return {
        ensureConnected: jest.fn(async () => undefined),
        setOnRemoteMeshFrame: jest.fn((hook) => {
          record.hook = hook;
        }),
        sendMeshFrame: jest.fn(async (frame: P2PMeshFrame) => {
          if (opts.hangSend?.({ localUserId: params.localUserId, otherUserId: params.otherUserId })) {
            await new Promise(() => undefined);
          }
          for (const remote of sessions.get(params.conversationId) || []) {
            if (remote.localUserId === params.localUserId) continue;
            await remote.hook?.(params.localUserId, frame);
          }
        }),
      };
    },
  };
}

function mockGunService(
  pair: SeaSigningPair,
  users: Record<string, { pub: string }>,
): WebGunService {
  return {
    getStoredPair: () => pair,
    getPublicUser: async (userId: string) => users[userId],
  } as unknown as WebGunService;
}

describe('PeerMeshService', () => {
  it('gossips talk announcements, pulls bodies, and routes mesh responses', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const network = createFakeNetwork();
    const bobBodies: P2PMeshTalkBodyPayload[] = [];
    const aliceResponses: P2PMeshTalkResponsePayload[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      onTalkResponse: (payload) => {
        aliceResponses.push(payload);
      },
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      onTalkBody: (payload) => {
        bobBodies.push(payload);
      },
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    await alice.broadcastTalk({
      id: 'talk-1',
      authorId: 'alice',
      title: 'Mesh Talk',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Ready?', answers: [] }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobBodies).toHaveLength(1);
    expect(bobBodies[0]).toEqual(expect.objectContaining({
      talkId: 'talk-1',
      authorId: 'alice',
      title: 'Mesh Talk',
    }));
    expect(bobBodies[0].talkData).toEqual(expect.objectContaining({ id: 'talk-1' }));

    await bob.sendTalkResponse({
      responseId: 'resp-1',
      talkId: 'talk-1',
      authorId: 'alice',
      responderId: 'bob',
      submittedAt: new Date().toISOString(),
      encryption: 'sea-ecdh-v1',
      payloadCiphertext: 'SEA{"ct":"ciphertext"}',
      transportMode: 'mesh-p2p',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(aliceResponses).toEqual([
      expect.objectContaining({
        responseId: 'resp-1',
        talkId: 'talk-1',
        responderId: 'bob',
        transportMode: 'mesh-p2p',
      }),
    ]);
  });

  it('does not block room broadcasts on one slow neighbor send', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };
    const network = createFakeNetwork({
      hangSend: ({ localUserId, otherUserId }) => localUserId === 'alice' && otherUserId === 'carol',
    });
    const bobBodies: P2PMeshTalkBodyPayload[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      sendTimeoutMs: 20,
      retryTimeoutMs: 20,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      onTalkBody: (payload) => {
        bobBodies.push(payload);
      },
    });
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'carol',
      localStageName: 'Carol',
      createSession: network.createSession,
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
      { userId: 'carol', stageName: 'Carol' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);
    await carol.joinRoom('global', members);

    const started = Date.now();
    await alice.broadcastTalk({
      id: 'talk-slow-peer',
      authorId: 'alice',
      title: 'Slow Peer',
      questions: [],
    });

    expect(Date.now() - started).toBeLessThan(1_000);
    expect(bobBodies).toHaveLength(1);
    expect(bobBodies[0]).toEqual(expect.objectContaining({
      talkId: 'talk-slow-peer',
      authorId: 'alice',
    }));
  });

  it('delivers same talk id from different authors independently', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };
    const network = createFakeNetwork();
    const bobBodies: P2PMeshTalkBodyPayload[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      onTalkBody: (payload) => {
        bobBodies.push(payload);
      },
    });
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'carol',
      localStageName: 'Carol',
      createSession: network.createSession,
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
      { userId: 'carol', stageName: 'Carol' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);
    await carol.joinRoom('global', members);

    await alice.broadcastTalk({
      id: 'shared-content-id',
      authorId: 'alice',
      title: 'Shared Tag',
      type: 'tag',
      questions: [],
    });
    await carol.broadcastTalk({
      id: 'shared-content-id',
      authorId: 'carol',
      title: 'Shared Tag',
      type: 'tag',
      questions: [],
    });

    expect(bobBodies.map((payload) => payload.authorId).sort()).toEqual(['alice', 'carol']);
  });

  it('re-delivers a talk body that the receiver rejected, then dedupes once accepted', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const network = createFakeNetwork();
    let accept = false; // bob rejects until verified, then accepts
    const bobBodies: P2PMeshTalkBodyPayload[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      // Return false while "unverified" so the talk stays eligible for re-delivery.
      onTalkBody: (payload) => {
        bobBodies.push(payload);
        return accept;
      },
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    const adultTalk = { id: 'adult-1', authorId: 'alice', title: 'Adult', type: 'flow', isAdult: true, questions: [] };

    // Rejected delivery: bob is called but does not mark the talk delivered.
    await alice.broadcastTalk({ ...adultTalk });
    expect(bobBodies).toHaveLength(1);

    // Re-broadcast while still rejecting: must reach bob again (not deduped away).
    await alice.broadcastTalk({ ...adultTalk });
    expect(bobBodies).toHaveLength(2);

    // Bob crosses the threshold and now accepts; this delivery is recorded.
    accept = true;
    await alice.broadcastTalk({ ...adultTalk });
    expect(bobBodies).toHaveLength(3);

    // Further re-broadcasts are deduped now that the talk was accepted.
    await alice.broadcastTalk({ ...adultTalk });
    expect(bobBodies).toHaveLength(3);
  });

  /**
   * Regression: onPing/onPong must expose frame.originUserId (the cryptographically-verified
   * ping/pong originator) — NOT _fromUserId (the immediate relay hop).
   *
   * Topology (sparse chain): Alice --K=1--> Bob --K=12--> Carol
   *   Alice has maxNeighbors=1 so she only connects to Bob (alphabetically first: bob < carol).
   *   Bob has default K so he connects to both Alice and Carol.
   *   Carol has default K so she also connects to Bob (bidirectional bob↔carol channel).
   *   Alice has NO direct channel to Carol.
   *
   * Expected propagation:
   *   Alice.sendPing() → sent to Bob (Alice's only neighbor)
   *   Bob receives ping, forwards to Carol (skipping Alice = fromUserId)
   *   Carol receives forwarded ping; onPing must report frame.originUserId = 'alice', NOT 'bob'
   *
   * Also verifies msgId is preserved end-to-end (forwardFrame spreads the frame without
   * generating a new msgId, preserving seen-set deduplication).
   *
   * A separate assertion covers onPong: when a pong is forwarded, the callback must receive
   * the pong sender's originUserId, not the relay's userId.  We verify this by injecting a
   * synthetic forwarded pong frame directly into Alice's handleRemoteFrame using the
   * internal session hook, exercising the same code path as a real relay.
   */
  it('onPing reports originUserId through a relay hop, msgId stable across forwarding', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob:   { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };
    const network = createFakeNetwork();

    const carolPings: Array<{ originUserId: string; msgId: string }> = [];
    const alicePongs: Array<{ originUserId: string; msgId: string }> = [];

    // Alice: K=1 sparse; only connects to Bob (bob sorts before carol alphabetically).
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      maxNeighbors: 1,
      createSession: network.createSession,
      onPong: (originUserId, frame) => {
        alicePongs.push({ originUserId, msgId: (frame.payload as { msgId?: string }).msgId ?? '' });
      },
    });
    // Bob: default K; relay between Alice and Carol.
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
    });
    // Carol: default K; connects to both Alice and Bob bidirectionally.
    // Using default K ensures carol↔bob channel exists so Bob can forward to Carol.
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'carol',
      localStageName: 'Carol',
      createSession: network.createSession,
      onPing: (originUserId, frame) => {
        carolPings.push({ originUserId, msgId: frame.msgId });
      },
    });

    const allMembers = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob',   stageName: 'Bob' },
      { userId: 'carol', stageName: 'Carol' },
    ];
    // Join order matters for channel registration: Bob and Carol must register their
    // shared channel before Alice sends the ping so Bob can forward.
    await bob.joinRoom('global', allMembers);
    await carol.joinRoom('global', allMembers);
    await alice.joinRoom('global', allMembers);

    // Alice sends the ping; capture the returned msgId.
    const sentMsgId = await alice.sendPing('relay-test');

    // Wait one microtask cycle for async frame propagation through the relay.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Carol must have received the ping with Alice as the origin (not Bob the relay).
    expect(carolPings.length).toBeGreaterThanOrEqual(1);
    // All received pings should attribute Alice as origin regardless of which hop delivered them.
    for (const ping of carolPings) {
      expect(ping.originUserId).toBe('alice');
    }

    // The msgId must be preserved through the relay hop (no re-wrapping on forwardFrame).
    expect(carolPings[0].msgId).toBe(sentMsgId);
  });

  /**
   * Companion regression: onPong must report frame.originUserId (the pong sender),
   * not the relay's userId.  Verifies the same one-line fix in handleLocalFrame for pongs.
   *
   * Uses a direct 2-peer setup (alice ↔ bob) so we can inject a synthetic pong that was
   * originally sent by a third party ('carol') but arrives via Bob.  The pong's
   * frame.originUserId is 'carol'; the delivering channel peer (fromUserId) is 'bob'.
   * Alice's onPong must see 'carol', not 'bob'.
   */
  it('onPong reports originUserId of the pong sender, not the relay hop', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob:   { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };

    // Capture Alice's inbound frame hook so we can inject a synthetic pong.
    let aliceRemoteFrameHook: ((fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>) | undefined;

    const alicePongs: Array<{ originUserId: string }> = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: (params) => {
        // Intercept the hook registration to capture the inbound frame handler.
        const session = {
          ensureConnected: jest.fn(async () => undefined),
          setOnRemoteMeshFrame: jest.fn((hook: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => {
            if (params.otherUserId === 'bob') {
              aliceRemoteFrameHook = hook;
            }
          }),
          sendMeshFrame: jest.fn(async () => undefined),
        };
        return session;
      },
      onPong: (originUserId) => { alicePongs.push({ originUserId }); },
    });

    await alice.joinRoom('global', [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob',   stageName: 'Bob' },
    ]);

    // Build a valid pong frame whose originUserId is 'carol', signed by carolPair.
    // This simulates a pong sent by Carol that was forwarded by Bob to Alice.
    const pongFrame: P2PMeshFrame = {
      version: 1,
      kind: 'mesh-pong',
      msgId: 'pong-msg-id-456',
      roomId: 'global',
      originUserId: 'carol',
      originPub: carolPair.pub,
      recipientUserId: 'alice',
      createdAt: new Date().toISOString(),
      ttlHops: 7,
      payload: { msgId: 'ping-msg-id-123' },
    };
    const proof = await createSignedP2PEnvelopeProof({
      pair: carolPair as SeaSigningPair,
      payload: p2pMeshFrameSigningPayload(pongFrame),
    });
    const signedPong: P2PMeshFrame = { ...pongFrame, proof };

    // Deliver the pong to Alice as if it arrived from Bob (the relay hop).
    expect(aliceRemoteFrameHook).toBeDefined();
    await aliceRemoteFrameHook!('bob', signedPong);

    // onPong must receive carol's userId (originUserId), not bob's (fromUserId / relay).
    expect(alicePongs).toHaveLength(1);
    expect(alicePongs[0].originUserId).toBe('carol');
  });
});
