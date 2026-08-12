import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import {
  createSignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
} from '../../shared/p2p-runtime';
import type { WebGunService } from './web-gun-service';
import {
  ConnectivityBindingVerifier,
  issueConnectivityBinding,
  type ConnectivityBinding,
} from '../../shared/connectivity-binding';
import { VerifiedConnectivityBindingStore } from './connectivity-binding-store';

export const LIBP2P_MESH_PROTOCOL = '/iinpublic/mesh/1.0.0';
const LIBP2P_BINDINGS_KEY = 'p2p-peer-bindings';
const CONNECTIVITY_BINDINGS_KEY = 'connectivity-bindings';

type Libp2pPeerId = {
  toString: () => string;
};

type Libp2pStream = {
  source: AsyncIterable<Uint8Array>;
  sink: (source: AsyncIterable<Uint8Array>) => Promise<void>;
};

type Libp2pLike = {
  peerId?: Libp2pPeerId;
  handle: (protocol: string, handler: (event: { stream: Libp2pStream }) => void | Promise<void>) => void;
  dialProtocol: (peer: string | Libp2pPeerId, protocol: string) => Promise<Libp2pStream>;
};

type MeshSession = {
  ensureConnected: () => Promise<void>;
  sendMeshFrame: (frame: P2PMeshFrame) => Promise<void>;
  setOnRemoteMeshFrame: (hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>) => void;
  dispose?: () => void;
};

type Libp2pBindingRecord = {
  userId: string;
  seaPub: string;
  peerId: string;
  addresses: string[];
  issuedAt: string;
  proof: SignedP2PEnvelopeProof;
};

type Libp2pMeshSessionConfig = {
  conversationId: string;
  localUserId: string;
  localPub: string;
  localPair: SeaSigningPair;
  otherUserId: string;
  otherPub: string;
  gunService: WebGunService;
  ensureLibp2pNode: () => Promise<unknown>;
  onRemoteMeshFrame: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
};

function bindingSigningPayload(record: Omit<Libp2pBindingRecord, 'proof'>): Record<string, unknown> {
  return {
    type: 'libp2p-user-peer-binding',
    userId: record.userId,
    seaPub: record.seaPub,
    peerId: record.peerId,
    addresses: record.addresses,
    issuedAt: record.issuedAt,
  };
}

class Libp2pMeshRuntime {
  private static readonly instances = new Map<string, Libp2pMeshRuntime>();

  static forLocalUser(localUserId: string): Libp2pMeshRuntime {
    const existing = this.instances.get(localUserId);
    if (existing) return existing;
    const created = new Libp2pMeshRuntime();
    this.instances.set(localUserId, created);
    return created;
  }

  private readonly sessions = new Set<Libp2pMeshSession>();
  private handlerBound = false;

  private constructor() {}

  register(session: Libp2pMeshSession): void {
    this.sessions.add(session);
  }

  unregister(session: Libp2pMeshSession): void {
    this.sessions.delete(session);
  }

  async ensureHandler(node: Libp2pLike): Promise<void> {
    if (this.handlerBound) return;
    node.handle(LIBP2P_MESH_PROTOCOL, async ({ stream }) => {
      let buffer = '';
      const decoder = new TextDecoder();
      for await (const chunk of stream.source) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let frame: P2PMeshFrame | null = null;
          try {
            frame = JSON.parse(trimmed) as P2PMeshFrame;
          } catch {
            frame = null;
          }
          if (!frame?.originUserId) continue;
          await this.dispatch(frame.originUserId, frame);
        }
      }
    });
    this.handlerBound = true;
  }

  private async dispatch(otherUserId: string, frame: P2PMeshFrame): Promise<void> {
    for (const session of this.sessions) {
      if (!session.isForPeer(otherUserId)) continue;
      await session.handleInboundFrame(otherUserId, frame);
    }
  }
}

class Libp2pMeshSession implements MeshSession {
  private readonly runtime: Libp2pMeshRuntime;
  private remotePeerId: string | null = null;
  private connected = false;
  private onRemoteMeshFrameHook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;

  constructor(private readonly config: Libp2pMeshSessionConfig) {
    this.runtime = Libp2pMeshRuntime.forLocalUser(config.localUserId);
    this.onRemoteMeshFrameHook = config.onRemoteMeshFrame;
    this.runtime.register(this);
  }

  isForPeer(otherUserId: string): boolean {
    return otherUserId === this.config.otherUserId;
  }

  async ensureConnected(): Promise<void> {
    const node = await this.ensureNode();
    await this.runtime.ensureHandler(node);
    await this.publishLocalBinding(node);
    this.remotePeerId = await this.resolveRemotePeerId();
    this.connected = !!this.remotePeerId;
    if (!this.connected) {
      throw new Error(`libp2p peer binding missing for ${this.config.otherUserId}`);
    }
  }

  async sendMeshFrame(frame: P2PMeshFrame): Promise<void> {
    if (!this.connected || !this.remotePeerId) {
      await this.ensureConnected();
    }
    const node = await this.ensureNode();
    if (!this.remotePeerId) {
      throw new Error(`libp2p peer binding missing for ${this.config.otherUserId}`);
    }
    const stream = await node.dialProtocol(this.remotePeerId, LIBP2P_MESH_PROTOCOL);
    const encoder = new TextEncoder();
    const payload = `${JSON.stringify(frame)}\n`;
    await stream.sink((async function* write() {
      yield encoder.encode(payload);
    })());
  }

  setOnRemoteMeshFrame(hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>): void {
    this.onRemoteMeshFrameHook = hook;
  }

  async handleInboundFrame(otherUserId: string, frame: P2PMeshFrame): Promise<void> {
    await this.onRemoteMeshFrameHook(otherUserId, frame);
  }

  dispose(): void {
    this.runtime.unregister(this);
  }

  private async ensureNode(): Promise<Libp2pLike> {
    const node = await this.config.ensureLibp2pNode();
    if (!node || typeof node !== 'object') {
      throw new Error('libp2p node unavailable');
    }
    const libp2p = node as Libp2pLike;
    if (typeof libp2p.handle !== 'function' || typeof libp2p.dialProtocol !== 'function') {
      throw new Error('libp2p node missing stream APIs');
    }
    return libp2p;
  }

  private async publishLocalBinding(node: Libp2pLike): Promise<void> {
    const peerId = String(node.peerId?.toString?.() || '').trim();
    if (!peerId) throw new Error('libp2p node missing peerId');
    const issuedAt = new Date();
    const bindingWithoutProof = {
      userId: this.config.localUserId,
      seaPub: this.config.localPub,
      peerId,
      addresses: [],
      issuedAt: issuedAt.toISOString(),
    };
    const proof = await createSignedP2PEnvelopeProof({
      pair: this.config.localPair,
      payload: bindingSigningPayload(bindingWithoutProof),
    });
    const binding: Libp2pBindingRecord = {
      ...bindingWithoutProof,
      proof,
    };
    await this.config.gunService.put(`${LIBP2P_BINDINGS_KEY}/${this.config.localUserId}`, binding);
    const common = await issueConnectivityBinding({
      pair: this.config.localPair,
      connectivityKind: 'libp2p-peer',
      connectivityId: peerId,
      sequence: issuedAt.getTime(),
      issuedAt,
      lifetimeMs: 24 * 60 * 60_000,
    });
    await this.config.gunService.put(
      `${CONNECTIVITY_BINDINGS_KEY}/${this.config.localUserId}/libp2p-peer`,
      common,
    );
  }

  private async resolveRemotePeerId(): Promise<string | null> {
    for (let i = 0; i < 6; i += 1) {
      try {
        const common = await this.config.gunService.get(
          `${CONNECTIVITY_BINDINGS_KEY}/${this.config.otherUserId}/libp2p-peer`,
        ) as ConnectivityBinding | null;
        if (common) {
          const verifier = new ConnectivityBindingVerifier(() => true);
          const verified = await verifier.verify(common);
          if (verified.ok && common.seaPub === this.config.otherPub) {
            try {
              await new VerifiedConnectivityBindingStore(this.config.gunService).put(common);
            } catch {
              // Older/mocked Gun services may not expose owner-private helpers yet;
              // successful live resolution must remain backward compatible.
            }
            return common.connectivityId;
          }
        }
        const raw = await this.config.gunService.get(
          `${LIBP2P_BINDINGS_KEY}/${this.config.otherUserId}`,
        ) as Libp2pBindingRecord | null;
        if (raw && (await this.verifyBinding(raw))) {
          // Mixed-version fallback. The peer will publish the common record when upgraded.
          return String(raw.peerId || '').trim() || null;
        }
      } catch {
        // Retry for eventual consistency.
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + i * 100));
    }
    return null;
  }

  private async verifyBinding(raw: Libp2pBindingRecord): Promise<boolean> {
    if (raw.userId !== this.config.otherUserId) return false;
    if (raw.seaPub !== this.config.otherPub) return false;
    if (!raw.peerId || !raw.proof) return false;
    const verification = await verifySignedP2PEnvelopeProof({
      proof: raw.proof,
      payload: bindingSigningPayload({
        userId: raw.userId,
        seaPub: raw.seaPub,
        peerId: raw.peerId,
        addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
        issuedAt: raw.issuedAt,
      }),
    });
    return verification.ok;
  }
}

const sessions = new Map<string, Libp2pMeshSession>();

function sessionKey(config: Libp2pMeshSessionConfig): string {
  return `${config.conversationId}::${config.localUserId}`;
}

export function getOrCreateLibp2pMeshSession(config: Libp2pMeshSessionConfig): MeshSession {
  const key = sessionKey(config);
  const existing = sessions.get(key);
  if (existing) {
    existing.setOnRemoteMeshFrame(config.onRemoteMeshFrame);
    return existing;
  }
  const session = new Libp2pMeshSession(config);
  const originalDispose = session.dispose?.bind(session);
  session.dispose = () => {
    sessions.delete(key);
    originalDispose?.();
  };
  sessions.set(key, session);
  return session;
}
