/**
 * OPEN-74 (native-app/39, 2026-10-18): a fresh `reconnect()` failed whenever the other phone had
 * not yet noticed that the old connection was gone — every pair's first reconnect online, and all
 * of them over an offline Wi-Fi Direct group, where the relay-only path carries no close notice.
 * The answering side applied the new offer to its old, still-"connected" RTCPeerConnection, which
 * refuses an offer from a new DTLS identity, so the offer was never answered. And a phone that only
 * answers offers had no way to get a fresh one after rebuilding its own side.
 *
 * A fake RTCPeerConnection that refuses an offer from a different peer connection (as Chrome does)
 * drives the session's signaling directly.
 */
import SEA from 'gun/sea';
import { P2PConversationSession } from '../../web/services/p2p-webrtc-session';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

/* eslint-disable @typescript-eslint/no-explicit-any */
class FakeChannel {
  readyState: 'connecting' | 'open' | 'closed' = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 'closed'; }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  static nextId = 0;
  readonly id = ++FakePeerConnection.nextId;
  signalingState: RTCSignalingState = 'stable';
  connectionState = 'new';
  iceConnectionState = 'new';
  closed = false;
  /** The remote connection this one is bound to after its first offer/answer. */
  boundTo: string | null = null;
  onicecandidate: unknown = null;
  onconnectionstatechange: unknown = null;
  oniceconnectionstatechange: unknown = null;
  ondatachannel: unknown = null;
  constructor() { FakePeerConnection.instances.push(this); }
  createDataChannel(): FakeChannel { return new FakeChannel(); }
  async createOffer() { return { type: 'offer', sdp: `pc-${this.id}` }; }
  async createAnswer() { return { type: 'answer', sdp: `pc-${this.id}` }; }
  async setLocalDescription(description: { type: string }) {
    this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    if (this.closed) throw new Error('InvalidStateError: closed');
    // A connection keeps its DTLS identity: an offer from another connection is refused.
    if (this.boundTo && this.boundTo !== description.sdp) throw new Error('InvalidModificationError: DTLS fingerprint changed');
    this.boundTo = description.sdp;
    this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
  }
  async addIceCandidate() {}
  close() { this.closed = true; }
}

type Posted = { kind: string; payload: any };
const created: P2PConversationSession[] = [];

function harness(pair: SeaSigningPair, otherPub: string, isInitiator: boolean) {
  const session = new P2PConversationSession({
    apiBase: 'http://127.0.0.1:1',
    conversationId: 'mesh:fresh-offer-test',
    gun: undefined,
    localUserId: isInitiator ? 'alice' : 'bob',
    localPub: pair.pub,
    localPair: pair,
    otherUserId: isInitiator ? 'bob' : 'alice',
    otherPub,
    isInitiator,
  } as any);
  const posted: Posted[] = [];
  (session as any).signaling = {
    post: async (_conversationId: string, body: { kind: string; signalCiphertext: string }) => {
      posted.push({ kind: body.kind, payload: JSON.parse(body.signalCiphertext.slice(3)) });
    },
    startPolling: () => () => undefined,
  };
  session.setIceConfigOverride({ iceServers: [] });
  created.push(session);
  const signal = (payload: unknown) => (session as any).handleRemoteSignal(payload);
  return { session, posted, signal };
}

async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe('P2P session: a fresh offer from a rebuilt connection (OPEN-74)', () => {
  let alicePair: SeaSigningPair;
  let bobPair: SeaSigningPair;
  const realPeerConnection = (globalThis as any).RTCPeerConnection;
  const realDescription = (globalThis as any).RTCSessionDescription;

  beforeAll(async () => {
    alicePair = await SEA.pair() as SeaSigningPair;
    bobPair = await SEA.pair() as SeaSigningPair;
    (globalThis as any).RTCPeerConnection = FakePeerConnection;
    (globalThis as any).RTCSessionDescription = class { constructor(init: object) { Object.assign(this, init); } };
  });

  afterAll(() => {
    (globalThis as any).RTCPeerConnection = realPeerConnection;
    (globalThis as any).RTCSessionDescription = realDescription;
  });

  beforeEach(() => { FakePeerConnection.instances = []; });
  afterEach(() => { for (const session of created.splice(0)) session.dispose(); });

  it('answers a new offer on a fresh connection while the old one still looks connected', async () => {
    const bob = harness(bobPair, alicePair.pub, false);
    void bob.session.ensureConnected(1_000).catch(() => undefined);
    await settle();
    await bob.signal({ type: 'offer', sdp: { type: 'offer', sdp: 'alice-pc-1' }, offerId: 'offer-1' });
    expect(bob.posted.filter((post) => post.kind === 'answer').map((post) => post.payload.offerId)).toEqual(['offer-1']);
    const first = FakePeerConnection.instances.at(-1)!;

    // Alice rebuilt her connection; Bob's old one has heard nothing of it.
    await bob.signal({ type: 'offer', sdp: { type: 'offer', sdp: 'alice-pc-2' }, offerId: 'offer-2' });
    await settle();
    expect(bob.posted.filter((post) => post.kind === 'answer').map((post) => post.payload.offerId)).toEqual(['offer-1', 'offer-2']);
    expect(first.closed).toBe(true);
    expect(FakePeerConnection.instances.at(-1)!.boundTo).toBe('alice-pc-2');

    // The same offer delivered again (a replay) is not answered twice.
    await bob.signal({ type: 'offer', sdp: { type: 'offer', sdp: 'alice-pc-2' }, offerId: 'offer-2' });
    expect(bob.posted.filter((post) => post.kind === 'answer')).toHaveLength(2);
  });

  it('the answering side asks for a fresh offer when it rebuilds, and the offering side makes one', async () => {
    const bob = harness(bobPair, alicePair.pub, false);
    void bob.session.reconnect(1_000).catch(() => undefined);
    await settle();
    const restart = bob.posted.find((post) => post.payload.type === 'restart');
    expect(restart?.kind).toBe('connection-state');

    const alice = harness(alicePair, bobPair.pub, true);
    void alice.session.ensureConnected(1_000).catch(() => undefined);
    await settle();
    expect(alice.posted.filter((post) => post.kind === 'offer')).toHaveLength(1);
    await alice.signal(restart!.payload);
    await settle();
    expect(alice.posted.filter((post) => post.kind === 'offer')).toHaveLength(2);
    // Acted on once, even if the queue delivers it again.
    await alice.signal(restart!.payload);
    await settle();
    expect(alice.posted.filter((post) => post.kind === 'offer')).toHaveLength(2);
    // A stale request (a replay long after) is ignored.
    await alice.signal({ ...restart!.payload, requestId: 'old', at: Date.now() - 60_000 });
    await settle();
    expect(alice.posted.filter((post) => post.kind === 'offer')).toHaveLength(2);
  });

  it('the Wi-Fi Direct switch asks for no extra offer (both sides switch)', async () => {
    const bob = harness(bobPair, alicePair.pub, false);
    void bob.session.reconnect(1_000, { requestOffer: false }).catch(() => undefined);
    await settle();
    expect(bob.posted.some((post) => post.payload.type === 'restart')).toBe(false);
  });
});
