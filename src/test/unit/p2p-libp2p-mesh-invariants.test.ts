import SEA from 'gun/sea';
import type { P2PMeshTalkBodyPayload, P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { PeerMeshService } from '../../web/services/peer-mesh-service';
import { getOrCreateLibp2pMeshSession } from '../../web/services/p2p-libp2p-mesh-session';
import type { WebGunService } from '../../web/services/web-gun-service';

type Stream = {
  source: AsyncIterable<Uint8Array>;
  sink: (source: AsyncIterable<Uint8Array>) => Promise<void>;
};

type Handler = (event: { stream: Stream }) => void | Promise<void>;

type FakeNode = {
  peerId: { toString: () => string };
  handle: (protocol: string, handler: Handler) => void;
  dialProtocol: (peer: string | { toString: () => string }, protocol: string) => Promise<Stream>;
};

function createFakeLibp2pNetwork(peerIds: string[]): Record<string, FakeNode> {
  const handlers = new Map<string, Handler>();
  const nodes: Record<string, FakeNode> = {};

  for (const peerId of peerIds) {
    nodes[peerId] = {
      peerId: { toString: () => peerId },
      handle: (protocol: string, handler: Handler) => {
        handlers.set(`${peerId}:${protocol}`, handler);
      },
      dialProtocol: async (peer: string | { toString: () => string }, protocol: string) => {
        const remotePeerId = typeof peer === 'string' ? peer : peer.toString();
        const remoteHandler = handlers.get(`${remotePeerId}:${protocol}`);
        if (!remoteHandler) throw new Error(`no handler for ${remotePeerId}:${protocol}`);
        return {
          source: (async function* noRead() {
            // Outbound-only sink for tests.
          })(),
          sink: async (source: AsyncIterable<Uint8Array>) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of source) chunks.push(chunk);
            await remoteHandler({
              stream: {
                source: (async function* incoming() {
                  for (const chunk of chunks) yield chunk;
                })(),
                sink: async () => undefined,
              },
            });
          },
        };
      },
    };
  }

  return nodes;
}

function createSharedBindingStore(): Map<string, unknown> {
  return new Map<string, unknown>();
}

function mockGunService(params: {
  pair: SeaSigningPair;
  users: Record<string, { pub: string }>;
  sharedBindings: Map<string, unknown>;
}): WebGunService {
  return {
    getStoredPair: () => params.pair,
    getPublicUser: async (userId: string) => params.users[userId],
    put: async (key: string, value: unknown) => {
      params.sharedBindings.set(key, value);
    },
    get: async (key: string) => {
      const value = params.sharedBindings.get(key);
      if (value === undefined) throw new Error(`missing key: ${key}`);
      return value;
    },
  } as unknown as WebGunService;
}

describe('libp2p mesh invariants (unit)', () => {
  test('ping, talk body delivery, and talk response routing hold over libp2p mesh sessions', async () => {
    const [alicePair, bobPair] = (await Promise.all([SEA.pair(), SEA.pair()])) as SeaSigningPair[];
    const users = {
      alice: { pub: alicePair.pub },
      bob: { pub: bobPair.pub },
    };
    const sharedBindings = createSharedBindingStore();
    const nodes = createFakeLibp2pNetwork(['peer-alice', 'peer-bob']);

    const aliceGun = mockGunService({ pair: alicePair, users, sharedBindings });
    const bobGun = mockGunService({ pair: bobPair, users, sharedBindings });

    const bobBodies: P2PMeshTalkBodyPayload[] = [];
    const aliceResponses: P2PMeshTalkResponsePayload[] = [];
    const bobPings: string[] = [];

    const alice = new PeerMeshService(aliceGun, {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'alice',
      localStageName: 'Alice',
      createSession: (params) =>
        getOrCreateLibp2pMeshSession({
          conversationId: params.conversationId,
          localUserId: params.localUserId,
          localPub: params.localPub,
          localPair: params.localPair,
          otherUserId: params.otherUserId,
          otherPub: params.otherPub,
          gunService: aliceGun,
          ensureLibp2pNode: async () => nodes['peer-alice'],
          onRemoteMeshFrame: params.onRemoteMeshFrame,
        }),
      onTalkResponse: (payload) => {
        aliceResponses.push(payload);
      },
    });

    const bob = new PeerMeshService(bobGun, {
      apiBase: 'http://127.0.0.1:8080',
      localUserId: 'bob',
      localStageName: 'Bob',
      createSession: (params) =>
        getOrCreateLibp2pMeshSession({
          conversationId: params.conversationId,
          localUserId: params.localUserId,
          localPub: params.localPub,
          localPair: params.localPair,
          otherUserId: params.otherUserId,
          otherPub: params.otherPub,
          gunService: bobGun,
          ensureLibp2pNode: async () => nodes['peer-bob'],
          onRemoteMeshFrame: params.onRemoteMeshFrame,
        }),
      onTalkBody: (payload) => {
        bobBodies.push(payload);
      },
      onPing: (fromUserId) => {
        bobPings.push(fromUserId);
      },
    });

    const members = [
      { userId: 'alice', stageName: 'Alice' },
      { userId: 'bob', stageName: 'Bob' },
    ];

    await Promise.all([
      alice.joinRoom('global', members),
      bob.joinRoom('global', members),
    ]);

    await alice.sendPing('hello');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobPings).toContain('alice');

    await alice.broadcastTalk({
      id: 'talk-libp2p-1',
      authorId: 'alice',
      title: 'Mesh Talk over libp2p',
      type: 'flow',
      questions: [{ id: 'q1', text: 'Ready?', answers: [] }],
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bobBodies).toHaveLength(1);
    expect(bobBodies[0]).toEqual(
      expect.objectContaining({
        talkId: 'talk-libp2p-1',
        authorId: 'alice',
      }),
    );

    const responseAt = new Date().toISOString();
    await bob.sendTalkResponse({
      responseId: 'resp-libp2p-1',
      talkId: 'talk-libp2p-1',
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
        responseId: 'resp-libp2p-1',
        talkId: 'talk-libp2p-1',
        responderId: 'bob',
      }),
    ]);

    alice.leaveRoom();
    bob.leaveRoom();
  });
});
