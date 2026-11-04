import SEA from 'gun/sea';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import type { P2PMeshFrame, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import { p2pMeshFrameSigningPayload } from '../../shared/p2p-mesh-protocol';
import { createSignedP2PEnvelopeProof } from '../../shared/p2p-runtime';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { portableSha256Hex } from '../../shared/portable-sha256';
import { ProtocolManifestController } from '../../shared/protocol-manifest-controller';
import {
  PROTOCOL_MANIFEST_FORMAT_VERSION,
  PROTOCOL_MANIFEST_KIND,
  PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
  createProtocolReleaseKey,
  protocolManifestHash,
  signProtocolManifest,
  type ProtocolManifestBody,
  type ProtocolManifestRuntimePolicy,
  type ProtocolManifestTrustState,
} from '../../shared/protocol-manifest';
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

const meshManifestRuntimePolicy: ProtocolManifestRuntimePolicy = {
  manifestEngineVersion: 1,
  roomProtocolVersion: 1,
  capabilities: ['room-presence-v1'],
  minimumChatroomCapacity: 1,
  maximumChatroomCapacity: 2_000,
};

function meshManifestAnchor(nextSigner: SeaSigningPair, recovery: SeaSigningPair): ProtocolManifestTrustState {
  return {
    networkId: 'iinpublic-mesh-test',
    sequence: 1,
    manifestHash: portableSha256Hex('iinpublic-mesh-test-manifest-1'),
    nextReleaseKeys: [createProtocolReleaseKey(nextSigner.pub)],
    recoveryPolicy: { threshold: 1, keys: [createProtocolReleaseKey(recovery.pub)] },
  };
}

function meshManifestBody(params: {
  sequence: number;
  previousManifestHash: string;
  nextSigner: SeaSigningPair;
  recovery: SeaSigningPair;
}): ProtocolManifestBody {
  return {
    kind: PROTOCOL_MANIFEST_KIND,
    formatVersion: PROTOCOL_MANIFEST_FORMAT_VERSION,
    networkId: 'iinpublic-mesh-test',
    sequence: params.sequence,
    previousManifestHash: params.previousManifestHash,
    protocolEpoch: params.sequence,
    effectiveAt: '2026-10-04T00:00:00.000Z',
    minimumManifestEngine: 1,
    minimumRoomProtocol: 1,
    chatroomCapacity: 498,
    requiredCapabilities: [],
    optionalCapabilities: ['manifest-relay-v1'],
    retirementMode: 'none',
    nextReleaseKeys: [createProtocolReleaseKey(params.nextSigner.pub)],
    recoveryPolicy: { threshold: 1, keys: [createProtocolReleaseKey(params.recovery.pub)] },
    signatureAlgorithm: PROTOCOL_MANIFEST_SIGNATURE_ALGORITHM,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('PeerMeshService', () => {
  it('does not drop a personal neighbor when a superseded connect promise has a live replacement', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const unreachable = jest.fn();
    const service = new PeerMeshService(mockGunService(alicePair, { bob: { pub: bobPair.pub } }), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      personalRoster: true,
      createSession: () => { throw new Error('not used'); },
      onPersonalPeerUnreachable: unreachable,
    });
    const dispose = jest.fn();
    const neighbor = {
      userId: 'bob',
      stageName: 'Bob',
      pub: bobPair.pub,
      connected: true,
      session: {
        ensureConnected: jest.fn().mockRejectedValue(new Error('WebRTC connection replaced')),
        getState: jest.fn(() => 'connecting'),
        sendMeshFrame: jest.fn(),
        setOnRemoteMeshFrame: jest.fn(),
        dispose,
      },
    };
    (service as any).neighbors.set('bob', neighbor);

    (service as any).connectNeighbor(neighbor);
    (service as any).connectNeighbor(neighbor);
    await new Promise((resolve) => setImmediate(resolve));

    expect((service as any).neighbors.get('bob')).toBe(neighbor);
    expect((service as any).connectFailures.has('bob')).toBe(false);
    expect(unreachable).not.toHaveBeenCalled();
    expect(dispose).not.toHaveBeenCalled();
  });

  it('synchronizes a complete authenticated manifest chain before exchanging room traffic', async () => {
    const [alicePair, bobPair, k2, k3, k4, recovery] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const anchor = meshManifestAnchor(k2, recovery);
    const m2 = await signProtocolManifest(meshManifestBody({
      sequence: 2,
      previousManifestHash: anchor.manifestHash,
      nextSigner: k3,
      recovery,
    }), k2);
    const m3 = await signProtocolManifest(meshManifestBody({
      sequence: 3,
      previousManifestHash: protocolManifestHash(m2),
      nextSigner: k4,
      recovery,
    }), k3);
    const [aliceController, bobController] = await Promise.all([
      ProtocolManifestController.create({ anchor, runtimePolicy: meshManifestRuntimePolicy }),
      ProtocolManifestController.create({
        anchor,
        runtimePolicy: meshManifestRuntimePolicy,
        bundledManifests: [m2, m3],
      }),
    ]);
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();
    const bobPings: string[] = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      protocolManifestController: aliceController,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      protocolManifestController: bobController,
      onPing: (fromUserId) => { bobPings.push(fromUserId); },
    });
    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];

    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);
    await waitUntil(() => aliceController.summary().sequence === 3
      && alice.getDiagnostics().manifestReadyNeighborCount === 1
      && bob.getDiagnostics().manifestReadyNeighborCount === 1);

    expect(aliceController.publicArchive()).toEqual([m2, m3]);
    await alice.sendPing('manifest-synchronized');
    await waitUntil(() => bobPings.includes('alice'));
    alice.leaveRoom();
    bob.leaveRoom();
  });

  it('a peer that forgot its ready neighbors (room restart after a manifest) is counted again', async () => {
    const [alicePair, bobPair, k2, recovery] = await Promise.all([
      SEA.pair(), SEA.pair(), SEA.pair(), SEA.pair(),
    ]) as SeaSigningPair[];
    const anchor = meshManifestAnchor(k2, recovery);
    const [aliceController, bobController] = await Promise.all([
      ProtocolManifestController.create({ anchor, runtimePolicy: meshManifestRuntimePolicy }),
      ProtocolManifestController.create({ anchor, runtimePolicy: meshManifestRuntimePolicy }),
    ]);
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      protocolManifestController: aliceController,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      protocolManifestController: bobController,
    });
    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];
    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);
    await waitUntil(() => alice.getDiagnostics().manifestReadyNeighborCount === 1
      && bob.getDiagnostics().manifestReadyNeighborCount === 1);

    // Alice clears her ready set and re-announces; Bob still counts her ready and must answer.
    alice.setProtocolManifestController(aliceController);
    await waitUntil(() => alice.getDiagnostics().manifestReadyNeighborCount === 1);
    expect(bob.getDiagnostics().manifestReadyNeighborCount).toBe(1);
    alice.leaveRoom();
    bob.leaveRoom();
  });

  it('rejects a same-sequence checkpoint fork and does not exchange room traffic', async () => {
    const [alicePair, bobPair, k2, recovery] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];
    const aliceAnchor = meshManifestAnchor(k2, recovery);
    const bobAnchor = {
      ...meshManifestAnchor(k2, recovery),
      manifestHash: portableSha256Hex('forked-iinpublic-mesh-test-manifest-1'),
    };
    const [aliceController, bobController] = await Promise.all([
      ProtocolManifestController.create({ anchor: aliceAnchor, runtimePolicy: meshManifestRuntimePolicy }),
      ProtocolManifestController.create({ anchor: bobAnchor, runtimePolicy: meshManifestRuntimePolicy }),
    ]);
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const network = createFakeNetwork();
    const bobPings: string[] = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: network.createSession,
      protocolManifestController: aliceController,
    });
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      protocolManifestController: bobController,
      onPing: (fromUserId) => { bobPings.push(fromUserId); },
    });
    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];

    await alice.joinRoom('global', members);
    await bob.joinRoom('global', members);
    await waitUntil(() => alice.getDiagnostics().manifestRejectedNeighborCount === 1
      && bob.getDiagnostics().manifestRejectedNeighborCount === 1);

    await alice.sendPing('must-not-cross-fork');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bobPings).toEqual([]);
    expect(alice.getDiagnostics().manifestReadyNeighborCount).toBe(0);
    expect(bob.getDiagnostics().manifestReadyNeighborCount).toBe(0);
    alice.leaveRoom();
    bob.leaveRoom();
  });

  it('resets the session to a neighbor that restarted (new roster epoch) even while it still reads connected', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const dispose = jest.fn();
    const ensureConnected = jest.fn(async () => undefined);
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: () => ({
        ensureConnected,
        getState: () => 'connected',
        dispose,
        setOnRemoteMeshFrame: jest.fn(),
        sendMeshFrame: jest.fn(async () => undefined),
      }),
    });
    await alice.joinRoom('global', [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob', epoch: 'run-1' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsBefore = ensureConnected.mock.calls.length;

    // Same epoch again: nothing to do.
    await alice.joinRoom('global', [{ userId: 'bob', stageName: 'Bob', epoch: 'run-1' }]);
    expect(dispose).not.toHaveBeenCalled();

    // Bob's app restarted.
    await alice.joinRoom('global', [{ userId: 'bob', stageName: 'Bob', epoch: 'run-2' }]);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(ensureConnected.mock.calls.length).toBeGreaterThan(callsBefore);
    alice.leaveRoom();
  });

  it('recreates apparently-connected neighbor transports when a backgrounded page resumes', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
    const disposals: jest.Mock[] = [];
    const alice = new PeerMeshService(mockGunService(alicePair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: () => {
        const dispose = jest.fn();
        disposals.push(dispose);
        return {
          ensureConnected: jest.fn(async () => undefined),
          getState: () => 'connected',
          dispose,
          setOnRemoteMeshFrame: jest.fn(),
          sendMeshFrame: jest.fn(async () => undefined),
        };
      },
    });
    await alice.joinRoom('nearby:test', [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(alice.getDiagnostics().connectedNeighborCount).toBe(1);
    expect(disposals).toHaveLength(1);

    await alice.resumeRoomConnections();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(disposals[0]).toHaveBeenCalledTimes(1);
    expect(disposals).toHaveLength(2);
    expect(alice.getDiagnostics().connectedNeighborCount).toBe(1);
    alice.leaveRoom();
  });

  it('reconnects a neighbor whose session died after it had connected (stale connected flag)', async () => {
    jest.useFakeTimers();
    try {
      const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
      const users = { alice: { pub: alicePair.pub }, bob: { pub: bobPair.pub } };
      let state = 'connected';
      const ensureConnected = jest.fn(async () => { state = 'connected'; });
      const alice = new PeerMeshService(mockGunService(alicePair, users), {
        apiBase: 'http://127.0.0.1:8080',
        localUserId: 'alice',
        localStageName: 'Alice',
        createSession: () => ({
          ensureConnected,
          getState: () => state,
          setOnRemoteMeshFrame: jest.fn(),
          sendMeshFrame: jest.fn(async () => undefined),
        }),
      });
      await alice.joinRoom('global', [{ userId: 'alice', stageName: 'Alice' }, { userId: 'bob', stageName: 'Bob' }]);
      await jest.advanceTimersByTimeAsync(0);
      expect(alice.getDiagnostics().connectedNeighborCount).toBe(1);
      const callsBefore = ensureConnected.mock.calls.length;

      state = 'failed'; // e.g. Bob's phone restarted
      expect(alice.getDiagnostics().connectedNeighborCount).toBe(0);
      await jest.advanceTimersByTimeAsync(2_500);
      expect(ensureConnected.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(alice.getDiagnostics().connectedNeighborCount).toBe(1);
      alice.leaveRoom();
    } finally {
      jest.useRealTimers();
    }
  });

  /**
   * Content-collision regression (find-similar-people 8/9): talk ids are content-addressed
   * (computeTalkCIDv1, no authorId), so two authors who create identical content share the
   * SAME talkId with different authorIds. The body cache must be author-qualified so a remote
   * author's identical-content body does NOT clobber the local author's own cached body —
   * otherwise the author-side response/match path (resolveMeshTalkData) and talk-body-request
   * serving would return the wrong author's definition.
   */

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

  it('processes one copy when direct and relayed frames arrive during signature verification', async () => {
    const alicePair = await SEA.pair() as SeaSigningPair;
    const responses: P2PMeshTalkResponsePayload[] = [];
    const alice = new PeerMeshService(mockGunService(alicePair, { alice: { pub: alicePair.pub } }), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: createFakeNetwork().createSession,
      onTalkResponse: (payload) => { responses.push(payload); },
    });

    let releaseVerification = (): void => {};
    const verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const verifyOrigin = jest
      .spyOn(alice as any, 'verifyOrigin')
      .mockImplementation(async () => {
        await verificationGate;
        return true;
      });
    await alice.joinRoom('global', [{ userId: 'alice', stageName: 'Alice' }]);
    const now = new Date().toISOString();
    const frame: P2PMeshFrame = {
      version: 1,
      kind: 'talk-response',
      msgId: 'same-direct-and-relayed-frame',
      roomId: 'global',
      originUserId: 'bob',
      originPub: 'bob-pub',
      recipientUserId: 'alice',
      createdAt: now,
      ttlHops: 6,
      payload: {
        responseId: 'one-response',
        talkId: 'talk-1',
        authorId: 'alice',
        responderId: 'bob',
        submittedAt: now,
        respondedAt: now,
        version: 1,
        encryption: 'sea-ecdh-v1',
        payloadCiphertext: 'SEA{"ct":"ciphertext"}',
        transportMode: 'mesh-p2p',
      },
    };

    const direct = (alice as any).handleRemoteFrame('bob', frame);
    const relayed = (alice as any).handleRemoteFrame('carol', frame);
    releaseVerification();
    await Promise.all([direct, relayed]);

    expect(verifyOrigin).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.responseId)).toEqual(['one-response']);
    expect(alice.getDiagnostics().transport).toMatchObject({
      receivedFrames: 2,
      duplicateFramesReceived: 1,
    });
  });

  /**
   * Coverage-gap fallback (find-similar-people root cause): when a room broadcast names more
   * recipients than the sender has links to, the connected overlay cannot guarantee full coverage — relay forwarding across a sparse, possibly
   * partitioned overlay can silently miss a peer. The mailbox fallback must fire even
   * when the sender's OWN K neighbors are all connected (connectedCount === neighbors.size),
   * which the original below-wanted-degree gate alone did not catch.
   * R-a step 7: asserts mailbox fallback (onMailboxFallback) fires instead of Gun rendezvous.
   */

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
      createSession: network.createSession,
      onPong: (originUserId, frame) => {
        alicePongs.push({ originUserId, msgId: (frame.payload as { msgId?: string }).msgId ?? '' });
      },
    });
    // Bob: forwarding is an explicit opt-in; this test exercises that relay path.
    const bob = new PeerMeshService(mockGunService(bobPair, users), {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: network.createSession,
      forwardingSettings: { enabled: true, wifiForwarding: true },
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
   * Room-topology eligibility: a peer in a different room does NOT receive a room frame.
   *
   * Alice is in room 'room-A'; Bob is in room 'room-B'.  A talk-retracted frame carries
   * roomId='room-A', so Bob's handleRemoteFrame drops it (roomId mismatch guard).
   * The test directly delivers a frame with a mismatched roomId to Bob's session hook and
   * confirms onTalkRetracted never fires.
   */
  it('a peer in a different room does not receive a room frame (roomId guard)', async () => {
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
      onTalkRetracted: (payload) => {
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
      kind: 'talk-retracted',
      msgId: 'cross-room-announce-1',
      roomId: 'room-A',          // ← different room; Bob is in room-B
      originUserId: 'alice',
      originPub: alicePair.pub,
      createdAt: new Date().toISOString(),
      ttlHops: 6,
      payload: { talkId: 'cross-room-talk', authorId: 'alice', retractedAt: Date.now() },
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

    // The ordered-switch gap has no active room. It must fail closed too; accepting here was the
    // real-device leak where a just-left room reached the next room before joinRoom completed.
    bob.leaveRoom();
    const noRoomFrame: P2PMeshFrame = {
      ...announceFrame,
      msgId: 'no-active-room-announce-1',
      roomId: 'room-B',
      payload: announceFrame.payload,
    };
    const noRoomProof = await createSignedP2PEnvelopeProof({
      pair: alicePair as SeaSigningPair,
      payload: p2pMeshFrameSigningPayload(noRoomFrame),
    });
    await bobRemoteFrameHook!('alice', { ...noRoomFrame, proof: noRoomProof });
    expect(bobAnnounces).toHaveLength(0);
  });

  /**
   * P0 step 2 — not-self eligibility: author does not receive their own announce.
   *
   * When Alice broadcasts and is also a member of her own session (e.g. she re-joins
   * to warm up the overlay), the talk-announce handler skips frames where
   * payload.authorId === localUserId, so Alice's own onTalkAnnounce never fires.
   */

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

  /**
   * P0 step 2 — mesh flood: announce from A reaches C via relay hop through B (K=1 path).
   *
   * Topology: Alice --K=1--> Bob --K=12--> Carol
   * Alice has only Bob as a neighbor; Bob forwards the announce to Carol.
   * Carol's onTalkAnnounce must fire with Alice's authorId even though the frame
   * arrived via Bob (the relay hop).
   */

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

  /**
   * Saturation gap (M4): a connected receiver that rejects a body (onTalkBody → false, e.g. a
   * filter/membership read that timed out under load) must NOT acknowledge it. An ACK would tell
   * the sender delivery succeeded and suppress the mailbox fallback, permanently dropping the body
   * even though the receiver never stored it. With the fix, the rejected recipient stays un-ACKed,
   * so the sender's mailbox fallback covers them and the talk can still be delivered (via drain).
   */

  /**
   * P0 step 3 — author-qualified delivery key: two talks with different authorIds but the
   * same talkId are gated independently. Alice accepted, Carol rejected → only Carol's copy
   * is eligible for re-delivery.
   *
   * Uses two isolated 2-node networks to avoid gossip relay duplicates (which are expected
   * when onTalkBody returns false in a multi-hop overlay).
   */

});
