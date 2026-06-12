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

function createFakeLibp2pNetwork(
  peerIds: string[],
  options?: {
    blockedDirectPairs?: Array<[string, string]>;
    relayPeerId?: string;
  },
): {
  nodes: Record<string, FakeNode>;
  relayHits: number;
} {
  const handlers = new Map<string, Handler>();
  const blocked = new Set<string>();
  const relayPeerId = options?.relayPeerId;
  let relayHits = 0;

  for (const [left, right] of options?.blockedDirectPairs || []) {
    blocked.add(`${left}->${right}`);
    blocked.add(`${right}->${left}`);
  }

  const deliverTo = async (targetPeerId: string, protocol: string, chunks: Uint8Array[]) => {
    const targetHandler = handlers.get(`${targetPeerId}:${protocol}`);
    if (!targetHandler) throw new Error(`no handler for ${targetPeerId}:${protocol}`);
    await targetHandler({
      stream: {
        source: (async function* incoming() {
          for (const chunk of chunks) yield chunk;
        })(),
        sink: async () => undefined,
      },
    });
  };

  const nodes: Record<string, FakeNode> = {};
  for (const peerId of peerIds) {
    nodes[peerId] = {
      peerId: { toString: () => peerId },
      handle: (protocol: string, handler: Handler) => {
        handlers.set(`${peerId}:${protocol}`, handler);
      },
      dialProtocol: async (peer: string | { toString: () => string }, protocol: string) => {
        const remotePeerId = typeof peer === 'string' ? peer : peer.toString();
        return {
          source: (async function* noRead() {
            // Outbound-only stream for tests.
          })(),
          sink: async (source: AsyncIterable<Uint8Array>) => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of source) chunks.push(chunk);
            const isDirectBlocked = blocked.has(`${peerId}->${remotePeerId}`);
            if (!isDirectBlocked) {
              await deliverTo(remotePeerId, protocol, chunks);
              return;
            }
            if (!relayPeerId) {
              throw new Error(`direct path blocked ${peerId}->${remotePeerId}`);
            }

            relayHits += 1;
            const relayHandler = handlers.get(`${relayPeerId}:${protocol}`);
            if (!relayHandler) {
              throw new Error(`relay handler missing for ${relayPeerId}:${protocol}`);
            }

            await relayHandler({
              stream: {
                source: (async function* incoming() {
                  for (const chunk of chunks) yield chunk;
                })(),
                sink: async (relaySource: AsyncIterable<Uint8Array>) => {
                  const relayedChunks: Uint8Array[] = [];
                  for await (const chunk of relaySource) relayedChunks.push(chunk);
                  await deliverTo(remotePeerId, protocol, relayedChunks);
                },
              },
            });
          },
        };
      },
    };
  }

  return {
    nodes,
    get relayHits() {
      return relayHits;
    },
  };
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
    const network = createFakeLibp2pNetwork(['peer-alice-1', 'peer-bob-1']);
    const nodes = network.nodes;
    const gunService = createGunStore();
    const received: P2PMeshFrame[] = [];

    const bobSession = getOrCreateLibp2pMeshSession({
      conversationId: 'mesh:global:alice-unit-1:bob-unit-1',
      localUserId: 'bob-unit-1',
      localPub: bobPair.pub,
      localPair: bobPair,
      otherUserId: 'alice-unit-1',
      otherPub: alicePair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-bob-1'],
      onRemoteMeshFrame: async (_otherUserId, frame) => {
        received.push(frame);
      },
    });

    const aliceSession = getOrCreateLibp2pMeshSession({
      conversationId: 'mesh:global:alice-unit-1:bob-unit-1',
      localUserId: 'alice-unit-1',
      localPub: alicePair.pub,
      localPair: alicePair,
      otherUserId: 'bob-unit-1',
      otherPub: bobPair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-alice-1'],
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
      originUserId: 'alice-unit-1',
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
      originUserId: 'alice-unit-1',
    });

    // Sanity: test wired to the canonical protocol id.
    expect(LIBP2P_MESH_PROTOCOL).toBe('/iinpublic/mesh/1.0.0');
    expect(network.relayHits).toBe(0);
    aliceSession.dispose?.();
    bobSession.dispose?.();
  });

  it('delivers frames via relay path when direct dial is NAT-blocked', async () => {
    const [alicePair, bobPair] = await Promise.all([
      SEA.pair(),
      SEA.pair(),
    ]) as SeaSigningPair[];

    const relayConversationId = 'mesh:global:alice-unit-2:bob-unit-2:relay-path';

    const network = createFakeLibp2pNetwork(['peer-alice-2', 'peer-bob-2', 'peer-relay-2'], {
      blockedDirectPairs: [['peer-alice-2', 'peer-bob-2']],
      relayPeerId: 'peer-relay-2',
    });
    const nodes = network.nodes;
    const gunService = createGunStore();
    const received: P2PMeshFrame[] = [];

    nodes['peer-relay-2'].handle(LIBP2P_MESH_PROTOCOL, async ({ stream }) => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream.source) chunks.push(chunk);
      await stream.sink((async function* relayOut() {
        for (const chunk of chunks) yield chunk;
      })());
    });

    const bobSession = getOrCreateLibp2pMeshSession({
      conversationId: relayConversationId,
      localUserId: 'bob-unit-2',
      localPub: bobPair.pub,
      localPair: bobPair,
      otherUserId: 'alice-unit-2',
      otherPub: alicePair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-bob-2'],
      onRemoteMeshFrame: async (_otherUserId, frame) => {
        received.push(frame);
      },
    });

    const aliceSession = getOrCreateLibp2pMeshSession({
      conversationId: relayConversationId,
      localUserId: 'alice-unit-2',
      localPub: alicePair.pub,
      localPair: alicePair,
      otherUserId: 'bob-unit-2',
      otherPub: bobPair.pub,
      gunService,
      ensureLibp2pNode: async () => nodes['peer-alice-2'],
      onRemoteMeshFrame: async () => undefined,
    });

    await Promise.all([
      aliceSession.ensureConnected(),
      bobSession.ensureConnected(),
    ]);

    const frame: P2PMeshFrame = {
      version: 1,
      kind: 'mesh-ping',
      msgId: 'msg-relay-1',
      roomId: 'global',
      originUserId: 'alice-unit-2',
      originPub: alicePair.pub,
      createdAt: new Date().toISOString(),
      ttlHops: 5,
      payload: { text: 'ping-over-relay' },
    };

    await aliceSession.sendMeshFrame(frame);

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      msgId: 'msg-relay-1',
      originUserId: 'alice-unit-2',
    });
    expect(network.relayHits).toBeGreaterThan(0);
    aliceSession.dispose?.();
    bobSession.dispose?.();
  });
});
