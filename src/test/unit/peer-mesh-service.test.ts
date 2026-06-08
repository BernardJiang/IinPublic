import SEA from 'gun/sea';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import type { P2PMeshFrame, P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { WebGunService } from '../../web/services/web-gun-service';

type FakeSessionRecord = {
  localUserId: string;
  hook?: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
};

function createFakeNetwork() {
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
});
