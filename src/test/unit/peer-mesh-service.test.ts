import SEA from 'gun/sea';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import type { P2PMeshFrame, P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
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
});
