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
  it('uses discovery fallback user ids to form neighbors when roster is sparse', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const network = createFakeNetwork();
    const bobPings: string[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      getDiscoveryUserIds: async () => ['bob'],
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      getDiscoveryUserIds: async () => ['alice'],
      onPing: (fromUserId) => {
        bobPings.push(fromUserId);
      },
    });

    // Each peer sees only itself in the local roster, then discovery supplies the neighbor.
    await alice.joinRoom('global', [{ userId: 'alice', stageName: 'Alice' }]);
    await bob.joinRoom('global', [{ userId: 'bob', stageName: 'Bob' }]);

    const connected = await alice.waitForConnectedNeighbor('bob', 2_000);
    expect(connected).toBe(true);

    await alice.sendPing('discovery-fallback');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobPings).toContain('alice');
  });

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

    const responseAt = new Date().toISOString();
    await bob.sendTalkResponse({
      responseId: 'resp-1',
      talkId: 'talk-1',
      authorId: 'alice',
      responderId: 'bob',
      submittedAt: responseAt,
      respondedAt: responseAt,
      version: 1,
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

  /**
   * Content-collision regression (find-similar-people 8/9): talk ids are content-addressed
   * (computeTalkCIDv1, no authorId), so two authors who create identical content share the
   * SAME talkId with different authorIds. The body cache must be author-qualified so a remote
   * author's identical-content body does NOT clobber the local author's own cached body —
   * otherwise the author-side response/match path (resolveMeshTalkData) and talk-body-request
   * serving would return the wrong author's definition.
   */
  it('keeps the local author copy when a remote author broadcasts the same content id', async () => {
    const [alicePair, carolPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, carol: { pub: carolPair.pub } };
    const network = createFakeNetwork();

    const carolBodies: P2PMeshTalkBodyPayload[] = [];
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'carol',
      localStageName: 'Carol',
      createSession: network.createSession,
      onTalkBody: (payload) => { carolBodies.push(payload); },
    });
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
    });

    const members = [{ userId: 'alice', stageName: 'Alice' }, { userId: 'carol', stageName: 'Carol' }];
    await carol.joinRoom('global', members);
    await alice.joinRoom('global', members);

    // Carol authored the SAME content id X and cached her own body.
    carol.cacheTalkBody('X', { id: 'X', authorId: 'carol', title: 'hiking', type: 'tag' });
    expect((carol.getCachedTalkBody('X') as any)?.authorId).toBe('carol');

    // Alice broadcasts identical content (same talkId X, authorId alice) — reaches Carol.
    await alice.broadcastTalk(
      { id: 'X', authorId: 'alice', title: 'hiking', type: 'tag', questions: [] },
      { roomBroadcast: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Carol received Alice's body with the correct (remote) author id...
    expect(carolBodies.map((b) => b.authorId)).toEqual(['alice']);
    // ...but Carol's OWN cached copy for talkId X is NOT clobbered (prefers localUserId).
    expect((carol.getCachedTalkBody('X') as any)?.authorId).toBe('carol');

    // When Carol later caches the remote author's body explicitly (as the app does on the
    // rendezvous path), it is stored author-qualified and does not overwrite her own copy.
    carol.cacheTalkBody('X', { id: 'X', authorId: 'alice', title: 'hiking', type: 'tag' });
    expect((carol.getCachedTalkBody('X') as any)?.authorId).toBe('carol');
    expect((carol.getCachedTalkBody('X', 'alice') as any)?.authorId).toBe('alice');
  });

  /**
   * Content-collision regression: a talk-response must reach BOTH authors of identical
   * content independently. Bob answers content id X authored by both Alice and Carol;
   * each author must receive Bob's response addressed to them.
   */
  it('routes a response to each author of identical content independently', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(), SEA.pair(), SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };
    const network = createFakeNetwork();
    const aliceResponses: P2PMeshTalkResponsePayload[] = [];
    const carolResponses: P2PMeshTalkResponsePayload[] = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice',
      createSession: network.createSession,
      onTalkResponse: (p) => { aliceResponses.push(p); },
    });
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'carol', localStageName: 'Carol',
      createSession: network.createSession,
      onTalkResponse: (p) => { carolResponses.push(p); },
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'bob', localStageName: 'Bob',
      createSession: network.createSession,
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
      { userId: 'carol', stageName: 'Carol' },
    ];
    await alice.joinRoom('global', members);
    await carol.joinRoom('global', members);
    await bob.joinRoom('global', members);

    // Bob answers the shared content id X for each author independently.
    const now = new Date().toISOString();
    await bob.sendTalkResponse({
      responseId: 'resp-alice', talkId: 'X', authorId: 'alice', responderId: 'bob',
      submittedAt: now, respondedAt: now, version: 1, encryption: 'sea-ecdh-v1',
      payloadCiphertext: 'SEA{"ct":"a"}', transportMode: 'mesh-p2p',
    });
    await bob.sendTalkResponse({
      responseId: 'resp-carol', talkId: 'X', authorId: 'carol', responderId: 'bob',
      submittedAt: now, respondedAt: now, version: 1, encryption: 'sea-ecdh-v1',
      payloadCiphertext: 'SEA{"ct":"c"}', transportMode: 'mesh-p2p',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(aliceResponses.map((r) => r.responseId)).toEqual(['resp-alice']);
    expect(carolResponses.map((r) => r.responseId)).toEqual(['resp-carol']);
  });

  /**
   * Coverage-gap fallback (find-similar-people root cause): when a room broadcast names more
   * recipients than the overlay degree bound (maxNeighbors) can directly hold, the connected
   * overlay cannot guarantee full coverage — relay forwarding across a sparse, possibly
   * partitioned overlay can silently miss a peer. The mailbox fallback must fire even
   * when the sender's OWN K neighbors are all connected (connectedCount === neighbors.size),
   * which the original below-wanted-degree gate alone did not catch.
   * R-a step 7: asserts mailbox fallback (onMailboxFallback) fires instead of Gun rendezvous.
   */
  it('ACK fallback mailboxes recipients that gossip does not reach', async () => {
    const alicePair = (await SEA.pair()) as SeaSigningPair;
    const peerIds = ['p1', 'p2', 'p3', 'p4', 'p5'];
    const users: Record<string, { pub: string }> = { alice: { pub: alicePair.pub } };
    for (const id of peerIds) users[id] = { pub: alicePair.pub };

    const gunService = mockGunService(alicePair, users);

    // maxNeighbors=3 (e2e bound). All 3 neighbors connect successfully via the fake network,
    // so connectedCount === neighbors.size === 3 and the below-wanted-degree gate is FALSE.
    const network = createFakeNetwork();
    const mailboxCalls: Array<{ recipientUserIds: string[] }> = [];
    const alice = new PeerMeshService(gunService, {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice',
      maxNeighbors: 3,
      ackTimeoutMs: 20,
      createSession: network.createSession,
      onMailboxFallback: async (_payload, recipientUserIds) => {
        mailboxCalls.push({ recipientUserIds });
      },
    });

    const members = [{ userId: 'alice' }, ...peerIds.map((userId) => ({ userId }))];
    await alice.joinRoom('global', members);

    // Prime the connected flag on the 3 selected neighbors via a throwaway broadcast.
    await alice.broadcastTalk(
      { id: 'prime', authorId: 'alice', title: 'p', type: 'tag', questions: [] },
      { recipientUserIds: peerIds, roomBroadcast: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alice.getDiagnostics().connectedNeighborCount).toBe(3);
    expect(alice.getDiagnostics().neighborCount).toBe(3);

    // Now broadcast to all 5 recipients. The fake sessions have no remote endpoints,
    // so none can ACK and the encrypted mailbox fallback must cover the missed peers.
    mailboxCalls.length = 0;
    await alice.broadcastTalk(
      { id: 'coverage-test', authorId: 'alice', title: 'c', type: 'tag', questions: [] },
      { recipientUserIds: peerIds, roomBroadcast: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Mailbox fallback must have fired (Gun p2pMeshTalkBodies/* path removed).
    expect(mailboxCalls.length).toBeGreaterThanOrEqual(1);
    // All 5 explicit recipients must be included in the fallback call.
    const allFallbackRecipients = mailboxCalls.flatMap((c) => c.recipientUserIds);
    for (const id of peerIds) {
      expect(allFallbackRecipients).toContain(id);
    }
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

  // ── Step 2: announce frame / eligibility ───────────────────────────────────────

  /**
   * P0 step 2 — onTalkAnnounce fires before body pull.
   *
   * Alice broadcasts a talk; Bob must receive the talk-announce callback BEFORE (or
   * simultaneously with) the talk-body callback, and must receive both in the same
   * event loop turn.  The announce payload carries talkId + authorId so callers can
   * record receipt for durable E2E diagnostics without waiting for the body.
   */
  it('step-2: onTalkAnnounce fires on talk-announce receipt, before body is delivered', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const network = createFakeNetwork();

    const bobAnnounces: Array<{ talkId: string; authorId: string }> = [];
    const bobBodies: P2PMeshTalkBodyPayload[] = [];
    const announceCallOrder: string[] = [];

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
      onTalkAnnounce: (payload) => {
        bobAnnounces.push({ talkId: payload.talkId, authorId: payload.authorId });
        announceCallOrder.push('announce');
      },
      onTalkBody: (payload) => {
        bobBodies.push(payload);
        announceCallOrder.push('body');
      },
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    await alice.broadcastTalk({
      id: 'announce-test-1',
      authorId: 'alice',
      title: 'Announce Test',
      type: 'tag',
      questions: [{ id: 'q1', text: 'Agree?', answers: [] }],
    });

    // Allow async propagation to settle
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Announce must have fired
    expect(bobAnnounces).toHaveLength(1);
    expect(bobAnnounces[0].talkId).toBe('announce-test-1');
    expect(bobAnnounces[0].authorId).toBe('alice');

    // Body must also have been delivered (room broadcast sends body alongside announce)
    expect(bobBodies).toHaveLength(1);
    expect(bobBodies[0].talkId).toBe('announce-test-1');

    // Announce fires first (talk-announce frame precedes talk-body frame in send order)
    expect(announceCallOrder[0]).toBe('announce');
  });

  it('rejects an offer before requesting or persisting the full body', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();
    const bodies: P2PMeshTalkBodyPayload[] = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice', createSession: network.createSession,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'bob', localStageName: 'Bob', createSession: network.createSession,
      onTalkAnnounce: () => false,
      onTalkBody: (payload) => { bodies.push(payload); return true; },
    });
    const members = [{ userId: 'alice' }, { userId: 'bob' }];
    await alice.joinRoom('global', members); await bob.joinRoom('global', members);
    await alice.broadcastTalk({ id: 'rejected-offer', authorId: 'alice', title: 'No', type: 'tag', questions: [] });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(bodies).toEqual([]);
    expect(bob.getDiagnostics().cachedTalkBodies).toBe(0);
  });

  /**
   * P0 step 2 — room-topology eligibility: peer in a different room does NOT receive
   * the announce.
   *
   * Alice is in room 'room-A'; Bob is in room 'room-B'.  A talk-announce frame carries
   * roomId='room-A', so Bob's handleRemoteFrame drops it (roomId mismatch guard at L577).
   * The test directly delivers a frame with a mismatched roomId to Bob's session hook and
   * confirms onTalkAnnounce never fires.
   */
  it('step-2: peer in a different room does not receive announce (roomId guard)', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };

    // Capture the remote frame hook Bob registers for its channel with Alice
    let bobRemoteFrameHook: ((fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>) | undefined;

    const bobAnnounces: Array<{ talkId: string }> = [];
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: (params) => ({
        ensureConnected: jest.fn(async () => undefined),
        setOnRemoteMeshFrame: jest.fn((hook: (fromUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => {
          if (params.otherUserId === 'alice') bobRemoteFrameHook = hook;
        }),
        sendMeshFrame: jest.fn(async () => undefined),
      }),
      onTalkAnnounce: (payload) => {
        bobAnnounces.push({ talkId: payload.talkId });
      },
    });

    // Bob joins room-B
    await bob.joinRoom('room-B', [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ]);

    // Build a valid talk-announce frame from Alice's room-A — different room than Bob's
    const announceFrame: P2PMeshFrame = {
      version: 1,
      kind: 'talk-announce',
      msgId: 'cross-room-announce-1',
      roomId: 'room-A',          // ← different room; Bob is in room-B
      originUserId: 'alice',
      originPub: alicePair.pub,
      createdAt: new Date().toISOString(),
      ttlHops: 6,
      payload: {
        talkId: 'cross-room-talk',
        authorId: 'alice',
        authorName: 'Alice',
        title: 'Cross-room Talk',
        questionCount: 1,
      },
    };
    const proof = await createSignedP2PEnvelopeProof({
      pair: alicePair as SeaSigningPair,
      payload: p2pMeshFrameSigningPayload(announceFrame),
    });
    const signed: P2PMeshFrame = { ...announceFrame, proof };

    expect(bobRemoteFrameHook).toBeDefined();
    await bobRemoteFrameHook!('alice', signed);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Bob must NOT have received the announce — roomId guard drops it
    expect(bobAnnounces).toHaveLength(0);
  });

  /**
   * P0 step 2 — not-self eligibility: author does not receive their own announce.
   *
   * When Alice broadcasts and is also a member of her own session (e.g. she re-joins
   * to warm up the overlay), the talk-announce handler skips frames where
   * payload.authorId === localUserId, so Alice's own onTalkAnnounce never fires.
   */
  it('step-2: author does not receive their own announce (not-self guard)', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const network = createFakeNetwork();

    const aliceAnnounces: Array<{ talkId: string }> = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      onTalkAnnounce: (payload) => {
        aliceAnnounces.push({ talkId: payload.talkId });
      },
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    await alice.broadcastTalk({
      id: 'self-announce-test',
      authorId: 'alice',
      title: 'Self Test',
      type: 'tag',
      questions: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Alice must NOT receive her own announce
    expect(aliceAnnounces).toHaveLength(0);
  });

  /**
   * P0 step 2 — conditional fallback: when the sender has zero connected neighbors,
   * publishRoomTalkBodyRendezvous (Gun rendezvous write) is called as a fallback so that
   * receivers using subscribeToRoomTalkBodyRendezvous still pick up the talk body.
   *
   * This covers the regression scenario from staged specs (08-super-user-copy-talk and
   * find-similar-people) where broadcastTalk fires immediately after joinRoom, before
   * any WebRTC DataChannel has been established (connectedNeighborCount === 0).
   *
   * Verification strategy: inject onMailboxFallback callback and confirm it fires when
   * zero neighbors are connected; confirm it does NOT fire when all neighbors are connected.
   */
  it('step-2 fallback: mailbox fallback fires when overlay is below wanted degree (incl. zero connected)', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };

    // Scenario A: zero connected neighbors (simulate callers like deliverTalkToReceiversOverMesh
    // that call joinRoom then immediately broadcastTalk without waiting for WebRTC connection).
    // We use a custom createSession that deliberately never sets neighbor.connected = true.
    const mailboxCallsA: Array<{ recipientUserIds: string[] }> = [];
    const aliceA = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: () => ({
        ensureConnected: jest.fn(async () => { throw new Error('not connected'); }),
        setOnRemoteMeshFrame: jest.fn(),
        // Never actually delivers — simulates a DataChannel still connecting.
        sendMeshFrame: jest.fn(async () => { throw new Error('not connected'); }),
      }),
      onMailboxFallback: async (_payload, recipientUserIds) => {
        mailboxCallsA.push({ recipientUserIds });
      },
    });

    await aliceA.joinRoom('global', [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ]);

    // Verify no neighbors are connected before broadcast.
    expect(aliceA.getDiagnostics().connectedNeighborCount).toBe(0);

    await aliceA.broadcastTalk({
      id: 'fallback-test-1',
      authorId: 'alice',
      title: 'Fallback Talk',
      type: 'tag',
      questions: [],
    }, { roomBroadcast: true });

    // Mailbox fallback must have fired (replaces Gun rendezvous path).
    expect(mailboxCallsA.length).toBeGreaterThanOrEqual(1);
    const fallbackRecipientsA = mailboxCallsA.flatMap((c) => c.recipientUserIds);
    expect(fallbackRecipientsA).toContain('bob');

    // Scenario B: fully connected wanted set (connected === neighbors.size) — fallback must NOT fire; primary
    // DataChannel path is used.
    const network = createFakeNetwork();
    const mailboxCallsB: Array<{ recipientUserIds: string[] }> = [];
    const aliceB = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      onMailboxFallback: async (_payload, recipientUserIds) => {
        mailboxCallsB.push({ recipientUserIds });
      },
    });
    const bobB = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await aliceB.joinRoom('global', members);
    await bobB.joinRoom('global', members);

    // Manually mark alice's neighbor as connected (simulating a completed WebRTC handshake).
    const aliceDiag = aliceB.getDiagnostics();
    expect(aliceDiag.neighborCount).toBeGreaterThan(0);
    // Drive the connect so the neighbor record flips to connected:true.
    // The fake network's ensureConnected resolves immediately, so calling broadcastTalk
    // after joinRoom is sufficient (sendMeshFrame succeeds synchronously on the fake network,
    // flipping neighbor.connected = true on first successful send).
    // Prime alice's neighbor connected flag by broadcasting once (fake net delivers instantly).
    await aliceB.broadcastTalk({
      id: 'prime-connect',
      authorId: 'alice',
      title: 'Prime',
      type: 'tag',
      questions: [],
    }, { roomBroadcast: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // After the first successful send, alice's neighbor is connected.
    const connectedAfterPrime = aliceB.getDiagnostics().connectedNeighborCount;
    expect(connectedAfterPrime).toBeGreaterThan(0);

    mailboxCallsB.length = 0;
    await aliceB.broadcastTalk({
      id: 'primary-path-test',
      authorId: 'alice',
      title: 'Primary Path',
      type: 'tag',
      questions: [],
    }, { roomBroadcast: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // No mailbox fallback must have fired — primary mesh path was used.
    expect(mailboxCallsB.length).toBe(0);
  });

  /**
   * P0 step 2 — mesh flood: announce from A reaches C via relay hop through B (K=1 path).
   *
   * Topology: Alice --K=1--> Bob --K=12--> Carol
   * Alice has only Bob as a neighbor; Bob forwards the announce to Carol.
   * Carol's onTalkAnnounce must fire with Alice's authorId even though the frame
   * arrived via Bob (the relay hop).
   */
  it('step-2: announce floods via relay hop to non-direct peer', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(), SEA.pair(), SEA.pair(),
    ]) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
      carol: { pub: carolPair.pub },
    };
    const network = createFakeNetwork();

    const carolAnnounces: Array<{ talkId: string; authorId: string }> = [];

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      maxNeighbors: 1,
      createSession: network.createSession,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
    });
    const carol = new PeerMeshService(mockGunService(carolPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'carol',
      localStageName: 'Carol',
      createSession: network.createSession,
      onTalkAnnounce: (payload) => {
        carolAnnounces.push({ talkId: payload.talkId, authorId: payload.authorId });
      },
    });

    const allMembers = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
      { userId: 'carol', stageName: 'Carol' },
    ];
    // Establish channels: bob↔carol first so the relay path is ready when Alice sends
    await bob.joinRoom('global', allMembers);
    await carol.joinRoom('global', allMembers);
    await alice.joinRoom('global', allMembers);

    await alice.broadcastTalk({
      id: 'relay-announce-1',
      authorId: 'alice',
      title: 'Relay Announce',
      type: 'tag',
      questions: [],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    // Carol must have received the announce via the Bob relay
    expect(carolAnnounces.length).toBeGreaterThanOrEqual(1);
    expect(carolAnnounces[0].authorId).toBe('alice');
    expect(carolAnnounces[0].talkId).toBe('relay-announce-1');
  });

  // ── Step 3: receiver-side intake filtering at the mesh choke point ────────────

  /**
   * P0 step 3 — onTalkBody returning false keeps the body eligible for re-delivery.
   *
   * When the caller's onTalkBody callback rejects a body (returns false), the mesh
   * service must NOT record the delivery key in deliveredTalkBodyIds.  A subsequent
   * broadcast of the same talkId::authorId must call onTalkBody again.  Once the
   * callback accepts (returns true), further broadcasts are deduped.
   *
   * This exercises the choke point at peer-mesh-service.ts lines 739-741 (DataChannel
   * path) for both the flood path and the re-delivery-after-rejection path.
   */
  it('step-3: intake-rejected body is not cached; accepted body is deduped', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();

    let bobAccepts = false; // simulates age-gate: false until verified
    const bobCallCount: Record<string, number> = {};

    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice',
      createSession: network.createSession,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'bob', localStageName: 'Bob',
      createSession: network.createSession,
      onTalkBody: (payload) => {
        const key = `${payload.talkId}::${payload.authorId}`;
        bobCallCount[key] = (bobCallCount[key] ?? 0) + 1;
        return bobAccepts; // false = rejected (age_gate), true = accepted
      },
    });

    const members = [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob' }];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    const adultTalk = { id: 'adult-mesh', authorId: 'alice', title: 'Adult Talk', type: 'flow', isAdult: true, questions: [] as any[] };

    // First broadcast: bob rejects (age_gate). onTalkBody called once, delivery NOT cached.
    await alice.broadcastTalk({ ...adultTalk });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobCallCount['adult-mesh::alice']).toBe(1);

    // Second broadcast while still rejecting: re-delivered (not deduped), onTalkBody called again.
    await alice.broadcastTalk({ ...adultTalk });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobCallCount['adult-mesh::alice']).toBe(2);

    // Bob crosses the age-verification threshold — now accepts.
    bobAccepts = true;
    await alice.broadcastTalk({ ...adultTalk });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobCallCount['adult-mesh::alice']).toBe(3);

    // Fourth broadcast: talk was accepted, delivery key is cached → NOT re-delivered.
    await alice.broadcastTalk({ ...adultTalk });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobCallCount['adult-mesh::alice']).toBe(3); // unchanged
  });

  /**
   * Saturation gap (M4): a connected receiver that rejects a body (onTalkBody → false, e.g. a
   * filter/membership read that timed out under load) must NOT acknowledge it. An ACK would tell
   * the sender delivery succeeded and suppress the mailbox fallback, permanently dropping the body
   * even though the receiver never stored it. With the fix, the rejected recipient stays un-ACKed,
   * so the sender's mailbox fallback covers them and the talk can still be delivered (via drain).
   */
  it('does not ACK a rejected body, so the sender mailbox-fallbacks the rejecting recipient', async () => {
    const [alicePair, bobPair] = (await Promise.all([SEA.pair(), SEA.pair()])) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();

    const mailboxCalls: Array<{ recipientUserIds: string[] }> = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice',
      ackTimeoutMs: 20,
      createSession: network.createSession,
      onMailboxFallback: async (_payload, recipientUserIds) => {
        mailboxCalls.push({ recipientUserIds });
      },
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080', localUserId: 'bob', localStageName: 'Bob',
      createSession: network.createSession,
      onTalkBody: () => false, // bob rejects (e.g. transient intake failure under saturation)
    });

    const members = [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob' }];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);

    // Prime the connected neighbor flag so bob is a real ack target (not just a mailbox target).
    await alice.broadcastTalk(
      { id: 'prime', authorId: 'alice', title: 'p', type: 'tag', questions: [] },
      { recipientUserIds: ['bob'], roomBroadcast: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    mailboxCalls.length = 0;
    await alice.broadcastTalk(
      { id: 'm4-reject', authorId: 'alice', title: 'r', type: 'tag', questions: [] },
      { recipientUserIds: ['bob'], roomBroadcast: true },
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Bob received the frame and rejected it; because he did not ACK, alice must mailbox him.
    expect(mailboxCalls.flatMap((c) => c.recipientUserIds)).toContain('bob');
  });

  /**
   * P0 step 3 — author-qualified delivery key: two talks with different authorIds but the
   * same talkId are gated independently. Alice accepted, Carol rejected → only Carol's copy
   * is eligible for re-delivery.
   *
   * Uses two isolated 2-node networks to avoid gossip relay duplicates (which are expected
   * when onTalkBody returns false in a multi-hop overlay).
   */
  it('step-3: different author copies of same talkId are filtered independently', async () => {
    const [alicePair, bobPair, carolPair] = await Promise.all([
      SEA.pair(), SEA.pair(), SEA.pair(),
    ]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub }, carol: { pub: carolPair.pub } };

    // Bob accepts alice's copy but rejects carol's copy.
    const acceptByAuthor: Record<string, boolean> = { alice: true, carol: false };
    const bobCallsByAuthor: Record<string, number> = {};

    function makeBob(net: ReturnType<typeof createFakeNetwork>) {
      return new PeerMeshService(mockGunService(bobPair, users), {
        apiBase: 'http://127.0.0.1:8080', localUserId: 'bob', localStageName: 'Bob',
        createSession: net.createSession,
        onTalkBody: (payload) => {
          bobCallsByAuthor[payload.authorId] = (bobCallsByAuthor[payload.authorId] ?? 0) + 1;
          return acceptByAuthor[payload.authorId] ?? true;
        },
      });
    }

    // ── Alice → Bob (2-node network, no relay) ──────────────────────────────────
    {
      const net = createFakeNetwork();
      const alice = new PeerMeshService(mockGunService(alicePair, users), {
        apiBase: 'http://127.0.0.1:8080', localUserId: 'alice', localStageName: 'Alice',
        createSession: net.createSession,
      });
      const bob = makeBob(net);
      const members = [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob' }];
      await alice.joinRoom('room-a', members);
      await bob.joinRoom('room-a', members);

      const sharedContent = { id: 'shared-id', title: 'Shared Talk', type: 'flow', questions: [] as any[] };

      // First broadcast: accepted.
      await alice.broadcastTalk({ ...sharedContent, authorId: 'alice' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bobCallsByAuthor['alice']).toBe(1);

      // Second broadcast: already cached, deduped.
      await alice.broadcastTalk({ ...sharedContent, authorId: 'alice' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bobCallsByAuthor['alice']).toBe(1); // unchanged
    }

    // ── Carol → Bob (separate 2-node network, no relay) ─────────────────────────
    {
      const net = createFakeNetwork();
      const carol = new PeerMeshService(mockGunService(carolPair, users), {
        apiBase: 'http://127.0.0.1:8080', localUserId: 'carol', localStageName: 'Carol',
        createSession: net.createSession,
      });
      const bob = makeBob(net);
      const members = [{ userId: 'carol', stageName: 'Carol' }, { userId: 'bob', stageName: 'Bob' }];
      await carol.joinRoom('room-b', members);
      await bob.joinRoom('room-b', members);

      const sharedContent = { id: 'shared-id', title: 'Shared Talk', type: 'flow', questions: [] as any[] };

      // First broadcast: rejected.
      await carol.broadcastTalk({ ...sharedContent, authorId: 'carol' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bobCallsByAuthor['carol']).toBe(1);

      // Second broadcast: still rejected → re-delivered (NOT deduped).
      await carol.broadcastTalk({ ...sharedContent, authorId: 'carol' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(bobCallsByAuthor['carol']).toBe(2);
    }
  });
});
