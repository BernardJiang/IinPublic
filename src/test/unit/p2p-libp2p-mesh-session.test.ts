import SEA from 'gun/sea';
import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { getOrCreateLibp2pMeshSession, LIBP2P_MESH_PROTOCOL } from '../../web/services/p2p-libp2p-mesh-session';
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
        if (!remoteHandler) {
          throw new Error(`no handler for ${remotePeerId}:${protocol}`);
        }
        return {
          source: (async function* noRead() {
            // Outbound-only stream for tests.
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

function createGunStore(): WebGunService {
  const store = new Map<string, unknown>();
  return {
    put: async (key: string, value: unknown) => {
      store.set(key, value);
    },
    get: async (key: string) => {
      const value = store.get(key);
      if (value === undefined) throw new Error(`missing key: ${key}`);
      return value;
    },
  } as unknown as WebGunService;
}

describe('libp2p mesh session adapter', () => {
  it('registers protocol handler and delivers frames over /iinpublic/mesh/1.0.0', async () => {
    const [alicePair, bobPair] = await Promise.all([SEA.pair(), SEA.pair()]) as SeaSigningPair[];
    const nodes = createFakeLibp2pNetwork(['peer-alice', 'peer-bob']);
    const gunService = createGunStore();
    const received: P2PMeshFrame[] = [];

    const bobSession = getOrCreateLibp2pMeshSession({
      conversationId: 'mesh:global:alice:bob',
      localUserId: 'bob',
      localPub: bobPair.pub,
      localPair: bobPair,
      otherUserId: 'alice',
      otherPub: alicePair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-bob'],
      onRemoteMeshFrame: async (_otherUserId, frame) => {
        received.push(frame);
      },
    });

    const aliceSession = getOrCreateLibp2pMeshSession({
      conversationId: 'mesh:global:alice:bob',
      localUserId: 'alice',
      localPub: alicePair.pub,
      localPair: alicePair,
      otherUserId: 'bob',
      otherPub: bobPair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-alice'],
      onRemoteMeshFrame: async () => undefined,
    });

    await Promise.all([
      aliceSession.ensureConnected(),
      bobSession.ensureConnected(),
    ]);

    const frame: P2PMeshFrame = {
      version: 1,
      kind: 'mesh-ping',
      msgId: 'msg-1',
      roomId: 'global',
      originUserId: 'alice',
      originPub: alicePair.pub,
      createdAt: new Date().toISOString(),
      ttlHops: 5,
      payload: { text: 'ping' },
    };

    await aliceSession.sendMeshFrame(frame);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      msgId: 'msg-1',
      kind: 'mesh-ping',
      originUserId: 'alice',
    });

    // Sanity: test wired to the canonical protocol id.
    expect(LIBP2P_MESH_PROTOCOL).toBe('/iinpublic/mesh/1.0.0');
  });
});
