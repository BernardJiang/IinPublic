import type { Message } from '../../shared/types';
import type { LedgerState } from '../../shared/types';
import {
  createSignedP2PEnvelopeProof,
  derivePeerIdFromPub,
  p2pDataChannelSigningPayload,
  p2pSignalingSigningPayload,
  verifySignedP2PEnvelopeProof,
  type SeaSigningPair,
} from '../../shared/p2p-runtime';
import {
  buildHandshakePayload,
  buildHandshakeDiagnostics,
  negotiateProtocol,
  validateHandshakePayload,
  type HandshakeDiagnostics,
  type P2PHandshakePayload,
} from '../../shared/p2p-handshake';
import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';
import { messageIntroducesGap } from '../../shared/conversation-reconcile';
import { BoundedNonceCache } from '../../shared/p2p-abuse-defense';
import { P2PSignalingClient, encodeSignalingPayload, type PostSignalingBody } from './p2p-signaling-client';

export type P2PConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';

type SignalPayload =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit; offerId?: string }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit; offerId?: string }
  | { type: 'ice'; candidate: RTCIceCandidateInit | null; offerId?: string };

type HandshakeWirePayload = {
  type: 'handshake';
  payload: P2PHandshakePayload;
};

type DmWirePayload = {
  type: 'dm';
  message: {
    id: string;
    senderId: string;
    text: string;
    timestamp: string;
    channel: string;
    transport: string;
    encryption?: 'sea-ecdh-v1';
    prevSeen?: string;
    isFromChatbot?: boolean;
  };
};

type LedgerStateWirePayload = {
  type: 'ledger-state';
  feeds: LedgerState;
};

type MeshWirePayload = {
  type: 'mesh';
  frame: P2PMeshFrame;
};

/** Phase 5: "here are the message ids I hold for this conversation" — peer backfills the rest. */
type SyncDigestWirePayload = {
  type: 'sync-digest';
  conversationId: string;
  messageIds: string[];
};

type ChannelFramePayload =
  | HandshakeWirePayload
  | DmWirePayload
  | LedgerStateWirePayload
  | MeshWirePayload
  | SyncDigestWirePayload;

type SignedChannelWirePayload = {
  type: 'signed-frame';
  peerId: string;
  pub: string;
  timestamp: string;
  nonce: string;
  payloadHash: string;
  signature: string;
  frame: ChannelFramePayload;
};

/** Local/same-machine peers should connect well under this; longer waits usually mean a bug. */
export const P2P_WEBRTC_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Returns the ICE server list for `RTCPeerConnection`.
 *
 * Connection priority order (§4.4):
 *   1. local / host candidates   — same-machine or LAN (no STUN/TURN needed)
 *   2. direct IP / srflx         — STUN-derived server-reflexive candidates
 *   3. NAT hole punch            — STUN/ICE coordinated traversal
 *   4. relay / TURN fallback     — only when all direct paths fail
 *
 * The browser WebRTC engine applies this ordering automatically via RFC 5245
 * candidate priority values: host > srflx > relay.  This function configures
 * which STUN/TURN servers are available; actual candidate selection is left
 * to the browser.  A TURN relay should be added to the returned list when
 * relay fallback (priority 4) is required in production.
 */
export function defaultIceServers(): RTCIceServer[] {
  const custom = typeof process !== 'undefined' ? process.env.E2E_WEBRTC_ICE_SERVERS : undefined;
  if (custom && custom.trim()) {
    try {
      const parsed = JSON.parse(custom) as RTCIceServer[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  // E2E webpack sets DISABLE_HMR=true — peers run on the same machine,
  // so host candidates (priority 1) are always used; STUN is not needed.
  if (typeof process !== 'undefined' && process.env.DISABLE_HMR === 'true') {
    return [];
  }
  // Production: provide STUN for NAT traversal (priorities 2–3).
  // Priority 4 relay requires a TURN server; add one via E2E_WEBRTC_ICE_SERVERS
  // or extend this list when relay fallback is required.
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
}

export type P2PSessionConfig = {
  apiBase: string;
  conversationId: string;
  localUserId: string;
  localPub: string;
  localPair?: SeaSigningPair;
  otherUserId: string;
  otherPub: string;
  isInitiator: boolean;
  getLedgerState?: () => LedgerState;
  onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  onRemoteMeshFrame?: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>;
  /** REQ-P2P-01: persist inbound DMs to local Gun before UI notify. */
  onRemoteDm?: (wire: DmWirePayload['message']) => void;
  /**
   * Phase 5 peer↔peer reconciliation (spec §19.4): the local message-id digest for this
   * conversation, sent on connect so the peer can backfill gaps directly (no hub).
   */
  getLocalMessageDigest?: () => Promise<string[]>;
  /** Phase 5: given the peer's digest ids, return the local wires the peer is missing. */
  getMessagesForBackfill?: (remoteMessageIds: string[]) => Promise<DmWirePayload['message'][]>;
};

export class P2PConversationSession {
  private _state: P2PConnectionState = 'idle';
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private signaling: P2PSignalingClient;
  private stopPolling: (() => void) | null = null;
  private readonly messages: Message[] = [];
  private readonly listeners = new Set<(messages: Message[]) => void>();
  private readonly lastSeenFromOther = new Map<string, string>();
  private connectPromise: Promise<void> | null = null;
  private remoteDescriptionSet = false;
  private makingOffer = false;
  /**
   * Correlates answers/ICE with the offer generation they belong to. Each connect
   * cycle (fresh RTCPeerConnection) gets a new offerId; the responder echoes the
   * offerId of the offer it answered. Without this, a STALE answer from a previous
   * timed-out cycle still sitting in the signaling queue gets applied to the new
   * RTCPeerConnection, consuming the one-shot `remoteDescriptionSet` slot so the
   * real answer is ignored — a connect livelock that repeats 10s-timeout cycles
   * under parallel E2E CPU load ("no mesh neighbors" flake).
   */
  private currentOfferId: string | null = null;
  private ledgerLocalSent = false;
  private ledgerRemoteReceived = false;
  private ledgerReady = false;
  /** Phase 5: debounce timer for a gap-triggered re-digest (coalesces bursts). */
  private reDigestTimer: ReturnType<typeof setTimeout> | null = null;
  // P2P-V: bounded nonce cache replaces unbounded Set to cap memory use
  private readonly dataChannelNonces = new BoundedNonceCache();
  // P2P-Q: handshake state
  private localHandshakePayload: P2PHandshakePayload | null = null;
  private handshakeDiagnostics: HandshakeDiagnostics | null = null;
  // Stash remote payload if it arrives before localHandshakePayload is ready
  private pendingRemoteHandshake: P2PHandshakePayload | null = null;

  constructor(private config: P2PSessionConfig) {
    this.signaling = new P2PSignalingClient(config.apiBase);
  }

  getState(): P2PConnectionState {
    return this._state;
  }

  /** P2P-Q: Returns a snapshot of the handshake negotiation diagnostics. */
  getHandshakeDiagnostics(): HandshakeDiagnostics | null {
    return this.handshakeDiagnostics;
  }

  getMessages(): Message[] {
    return [...this.messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  subscribe(listener: (messages: Message[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getMessages());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getMessages();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  setLedgerHooks(hooks: {
    getLedgerState?: () => LedgerState;
    onRemoteLedgerState?: (otherUserId: string, state: LedgerState) => void | Promise<void>;
  }): void {
    this.config = { ...this.config, ...hooks };
  }

  setOnRemoteDm(hook: (wire: DmWirePayload['message']) => void): void {
    this.config.onRemoteDm = hook;
  }

  setOnRemoteMeshFrame(hook: (otherUserId: string, frame: P2PMeshFrame) => void | Promise<void>): void {
    this.config.onRemoteMeshFrame = hook;
  }

  private setState(state: P2PConnectionState): void {
    this._state = state;
  }

  private markLedgerReady(): void {
    if (this.ledgerReady) return;
    this.ledgerReady = true;
  }

  private sendLedgerState(): void {
    if (!this.config.getLedgerState || !this.dc || this.dc.readyState !== 'open') {
      this.markLedgerReady();
      return;
    }
    const feeds = this.config.getLedgerState();
    void this.sendChannelFrame({ type: 'ledger-state', feeds } satisfies LedgerStateWirePayload)
      .catch(() => undefined);
    this.ledgerLocalSent = true;
    if (this.ledgerRemoteReceived || Object.keys(feeds).length === 0) {
      this.markLedgerReady();
    }
  }

  private async handleLedgerState(feeds: LedgerState): Promise<void> {
    this.ledgerRemoteReceived = true;
    if (this.config.onRemoteLedgerState) {
      await this.config.onRemoteLedgerState(this.config.otherUserId, feeds);
    }
    if (this.ledgerLocalSent || !this.config.getLedgerState) {
      this.markLedgerReady();
    }
  }

  private async waitForLedgerReady(timeoutMs = 3000): Promise<void> {
    if (this.ledgerReady || !this.config.getLedgerState) return;
    const started = Date.now();
    while (!this.ledgerReady && Date.now() - started < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.markLedgerReady();
  }

  private async postSignal(kind: PostSignalingBody['kind'], payload: SignalPayload): Promise<void> {
    if (!this.config.localPair) throw new Error('P2P signaling requires a SEA signing pair');
    const signalCiphertext = encodeSignalingPayload(payload);
    const proof = await createSignedP2PEnvelopeProof({
      pair: this.config.localPair,
      payload: p2pSignalingSigningPayload({
        conversationId: this.config.conversationId,
        kind,
        senderPub: this.config.localPub,
        recipientPub: this.config.otherPub,
        signalCiphertext,
      }),
    });
    const body: PostSignalingBody = {
      kind,
      senderPeerId: proof.peerId,
      senderPub: this.config.localPub,
      recipientPub: this.config.otherPub,
      signalCiphertext,
      timestamp: proof.timestamp,
      payloadHash: proof.payloadHash,
      signature: proof.signature,
      nonce: proof.nonce,
    };
    await this.signaling.post(this.config.conversationId, body);
  }

  ensureConnected(timeoutMs = P2P_WEBRTC_CONNECT_TIMEOUT_MS): Promise<void> {
    if (this._state === 'connected') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    if (this._state === 'failed') {
      this.resetTransport();
    }

    const attempt = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._state !== 'connected') {
          this.setState('failed');
          reject(new Error('WebRTC connection timeout'));
        }
      }, timeoutMs);

      const finish = () => {
        clearTimeout(timer);
        resolve();
      };

      void this.start()
        .then(() => {
          if (this._state === 'connected') finish();
          else {
            const check = setInterval(() => {
              if (this._state === 'connected') {
                clearInterval(check);
                finish();
              } else if (this._state === 'failed') {
                clearInterval(check);
                clearTimeout(timer);
                reject(new Error('WebRTC connection failed'));
              }
            }, 200);
          }
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });

    this.connectPromise = attempt;
    void attempt.catch(() => {
      if (this.connectPromise === attempt) this.connectPromise = null;
    });
    return attempt;
  }

  private resetTransport(): void {
    this.stopPolling?.();
    this.stopPolling = null;
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    this.remoteDescriptionSet = false;
    this.makingOffer = false;
    this.currentOfferId = null;
    this.setState('idle');
  }

  private async start(): Promise<void> {
    if (this._state === 'connecting' || this._state === 'connected') return;
    this.setState('connecting');

    this.stopPolling = this.signaling.startPolling(
      this.config.conversationId,
      this.config.localPub,
      async (_envelope, payload) => {
        await this.handleRemoteSignal(payload as SignalPayload);
      },
    );

    this.pc = new RTCPeerConnection({ iceServers: defaultIceServers() });
    this.pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void this.postSignal('ice-candidate', {
        type: 'ice',
        candidate: event.candidate.toJSON(),
        ...(this.currentOfferId ? { offerId: this.currentOfferId } : {}),
      }).catch(() => undefined);
    };
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc?.connectionState;
      if (cs === 'connected') {
        this.setState('connected');
      } else if (cs === 'failed' || cs === 'closed' || cs === 'disconnected') {
        this.setState('failed');
        this.connectPromise = null;
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const ice = this.pc?.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') {
        this.setState('connected');
      } else if (ice === 'failed') {
        this.setState('failed');
        this.connectPromise = null;
      }
    };

    if (this.config.isInitiator) {
      this.dc = this.pc.createDataChannel('iinpublic-dm', { ordered: true });
      this.attachDataChannel(this.dc);
      this.makingOffer = true;
      this.currentOfferId = `offer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.postSignal('offer', { type: 'offer', sdp: offer, offerId: this.currentOfferId });
      this.makingOffer = false;
    } else {
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.attachDataChannel(this.dc);
      };
    }
  }

  private async sendHandshake(): Promise<void> {
    if (!this.config.localPair) return;
    const peerId = await derivePeerIdFromPub(this.config.localPub);
    const payload = buildHandshakePayload({ peerId, publicKey: this.config.localPub });
    this.localHandshakePayload = payload;
    // If the remote handshake already arrived while we were computing peerId, process it now
    if (this.pendingRemoteHandshake) {
      const result = negotiateProtocol(payload, this.pendingRemoteHandshake);
      this.handshakeDiagnostics = buildHandshakeDiagnostics(payload, this.pendingRemoteHandshake, result);
      this.pendingRemoteHandshake = null;
    }
    const frame: HandshakeWirePayload = { type: 'handshake', payload };
    await this.sendChannelFrame(frame).catch(() => undefined);
  }

  private handleHandshake(payload: unknown): void {
    const validation = validateHandshakePayload(payload);
    if (!validation.ok) return; // silently drop malformed handshakes
    if (this.localHandshakePayload) {
      // Local is already set — compute diagnostics immediately
      const result = negotiateProtocol(this.localHandshakePayload, validation.payload);
      this.handshakeDiagnostics = buildHandshakeDiagnostics(
        this.localHandshakePayload,
        validation.payload,
        result,
      );
    } else {
      // Local not ready yet (derivePeerIdFromPub still pending) — stash for sendHandshake to process
      this.pendingRemoteHandshake = validation.payload;
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.setState('connected');
      void this.sendHandshake()
        .then(() => this.sendLedgerState())
        .then(() => this.sendSyncDigest());
    };
    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as SignedChannelWirePayload;
        void this.handleSignedChannelFrame(parsed);
      } catch {
        // ignore malformed frames
      }
    };
    channel.onclose = () => {
      this.setState('failed');
      this.connectPromise = null;
    };
    channel.onerror = () => {
      this.setState('failed');
      this.connectPromise = null;
    };
  }

  /**
   * Phase 5: on connect, advertise the local message-id digest so the peer can backfill
   * any messages we're missing directly over the DataChannel (no hub relay). Guarded +
   * isolated: a no-op without the hook, and errors never disturb the DM channel.
   */
  private async sendSyncDigest(): Promise<void> {
    if (!this.config.getLocalMessageDigest) return;
    try {
      const messageIds = await this.config.getLocalMessageDigest();
      await this.sendChannelFrame({
        type: 'sync-digest',
        conversationId: this.config.conversationId,
        messageIds: messageIds ?? [],
      });
    } catch (err) {
      console.warn(`P2P sync-digest send failed for ${this.config.conversationId}:`, err);
    }
  }

  /**
   * Phase 5: re-advertise our digest after a gap is detected (an incoming DM references a
   * `prevSeen` we don't hold) so the peer backfills the missing middle. Debounced to
   * coalesce a burst of out-of-order frames into a single digest. Strictly additive +
   * guarded: a no-op without the digest hook, and never throws into the DM path.
   */
  private scheduleReDigest(): void {
    if (!this.config.getLocalMessageDigest) return;
    if (this.reDigestTimer) return;
    this.reDigestTimer = setTimeout(() => {
      this.reDigestTimer = null;
      void this.sendSyncDigest();
    }, 250);
  }

  /** Phase 5: peer sent its digest → backfill the messages it is missing as `dm` frames. */
  private async handleSyncDigest(frame: SyncDigestWirePayload): Promise<void> {
    if (!this.config.getMessagesForBackfill || frame.conversationId !== this.config.conversationId) return;
    try {
      const missing = await this.config.getMessagesForBackfill(frame.messageIds ?? []);
      for (const wire of missing) {
        await this.sendChannelFrame({ type: 'dm', message: { ...wire, transport: wire.transport ?? 'direct-p2p' } });
      }
    } catch (err) {
      console.warn(`P2P sync backfill failed for ${this.config.conversationId}:`, err);
    }
  }

  private async sendChannelFrame(frame: ChannelFramePayload): Promise<void> {
    if (!this.config.localPair) throw new Error('P2P DataChannel frames require a SEA signing pair');
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('DataChannel not open');
    const proof = await createSignedP2PEnvelopeProof({
      pair: this.config.localPair,
      payload: p2pDataChannelSigningPayload({
        conversationId: this.config.conversationId,
        frame,
      }),
    });
    const signed: SignedChannelWirePayload = {
      type: 'signed-frame',
      peerId: proof.peerId,
      pub: this.config.localPub,
      timestamp: proof.timestamp,
      nonce: proof.nonce,
      payloadHash: proof.payloadHash,
      signature: proof.signature,
      frame,
    };
    this.dc.send(JSON.stringify(signed));
  }

  private async handleSignedChannelFrame(parsed: SignedChannelWirePayload): Promise<void> {
    if (parsed?.type !== 'signed-frame' || !parsed.frame || parsed.pub !== this.config.otherPub) return;
    const verification = await verifySignedP2PEnvelopeProof({
      proof: {
        peerId: parsed.peerId,
        pub: parsed.pub,
        timestamp: parsed.timestamp,
        nonce: parsed.nonce,
        payloadHash: parsed.payloadHash,
        signature: parsed.signature,
      },
      payload: p2pDataChannelSigningPayload({
        conversationId: this.config.conversationId,
        frame: parsed.frame,
      }),
      nonceCache: this.dataChannelNonces,
    });
    if (!verification.ok) return;
    if (parsed.frame.type === 'handshake') {
      this.handleHandshake(parsed.frame.payload);
      return;
    }
    if (parsed.frame.type === 'ledger-state') {
      await this.handleLedgerState(parsed.frame.feeds || {});
      return;
    }
    if (parsed.frame.type === 'mesh') {
      await this.config.onRemoteMeshFrame?.(this.config.otherUserId, parsed.frame.frame);
      return;
    }
    if (parsed.frame.type === 'sync-digest') {
      await this.handleSyncDigest(parsed.frame);
      return;
    }
    if (parsed.frame.type !== 'dm' || !('message' in parsed.frame) || !parsed.frame.message) return;
    if (!this.ledgerReady && this.config.getLedgerState) return;
    this.ingestWireMessage(parsed.frame.message);
  }

  private ingestWireMessage(wire: DmWirePayload['message'], options?: { skipRemotePersist?: boolean }): void {
    if (
      !options?.skipRemotePersist &&
      wire.senderId !== this.config.localUserId &&
      this.config.onRemoteDm
    ) {
      this.config.onRemoteDm(wire);
    }

    const msg: Message = {
      id: wire.id,
      senderId: wire.senderId,
      text: wire.text,
      timestamp: new Date(wire.timestamp),
      channel: (wire.channel as Message['channel']) || 'public',
      readBy: [],
      isFromChatbot: !!wire.isFromChatbot,
      ...(wire.prevSeen !== undefined ? { prevSeen: wire.prevSeen } : {}),
    };
    if (this.messages.some((m) => m.id === msg.id)) return;
    // Phase 5 gap detection: an inbound message whose predecessor we've never seen means
    // we're missing the middle of the thread — ask the peer to backfill via a re-digest.
    if (messageIntroducesGap(this.messages.map((m) => m.id), wire, this.config.localUserId)) {
      this.scheduleReDigest();
    }
    this.messages.push(msg);
    if (wire.senderId !== this.config.localUserId) {
      this.lastSeenFromOther.set(
        `${this.config.conversationId}:${this.config.localUserId}`,
        wire.id,
      );
    }
    this.notify();
  }

  private async handleRemoteSignal(payload: SignalPayload): Promise<void> {
    if (!this.pc) return;
    if (payload.type === 'offer') {
      if (this.makingOffer) return;
      // Track which offer generation we are answering so the initiator can
      // correlate our answer (and discard answers to retired offers).
      this.currentOfferId = payload.offerId ?? null;
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      this.remoteDescriptionSet = true;
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.postSignal('answer', {
        type: 'answer',
        sdp: answer,
        ...(this.currentOfferId ? { offerId: this.currentOfferId } : {}),
      });
    } else if (payload.type === 'answer') {
      // Drop answers that correspond to a previous (timed-out, reset) offer cycle;
      // applying them would consume `remoteDescriptionSet` and the real answer
      // for the current offer would then be ignored.
      if (payload.offerId && payload.offerId !== this.currentOfferId) return;
      if (this.config.isInitiator && !this.remoteDescriptionSet) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        this.remoteDescriptionSet = true;
      }
    } else if (payload.type === 'ice' && payload.candidate) {
      // Same correlation for ICE: candidates from a retired connect cycle target a
      // closed RTCPeerConnection on the other side and only pollute this one.
      if (payload.offerId && this.currentOfferId && payload.offerId !== this.currentOfferId) return;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // ignore duplicate/late candidates
      }
    }
  }

  async sendDm(
    senderId: string,
    text: string,
    channel: Message['channel'] = 'public',
    persistedWire?: Partial<DmWirePayload['message']> & Pick<DmWirePayload['message'], 'id' | 'senderId' | 'text' | 'timestamp' | 'channel'>,
  ): Promise<void> {
    await this.ensureConnected();
    await this.waitForLedgerReady();
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }
    const prevSeen =
      this.lastSeenFromOther.get(`${this.config.conversationId}:${senderId}`) ?? undefined;
    const message: DmWirePayload['message'] = persistedWire
      ? { ...persistedWire, transport: persistedWire.transport ?? 'direct-p2p' }
      : {
          id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          senderId,
          text,
          timestamp: new Date().toISOString(),
          channel,
          transport: 'direct-p2p',
          ...(prevSeen !== undefined ? { prevSeen } : {}),
        };
    const wire = { type: 'dm' as const, message };
    await this.sendChannelFrame(wire);
    this.ingestWireMessage(wire.message, { skipRemotePersist: true });
  }

  async sendMeshFrame(frame: P2PMeshFrame): Promise<void> {
    await this.ensureConnected();
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }
    await this.sendChannelFrame({ type: 'mesh', frame });
  }

  dispose(): void {
    if (this.reDigestTimer) {
      clearTimeout(this.reDigestTimer);
      this.reDigestTimer = null;
    }
    this.resetTransport();
    this.connectPromise = null;
  }
}

const sessionRegistry = new Map<string, P2PConversationSession>();

function sessionKey(conversationId: string, localUserId: string): string {
  return `${conversationId}:${localUserId}`;
}

export function getOrCreateP2PSession(config: P2PSessionConfig): P2PConversationSession {
  const key = sessionKey(config.conversationId, config.localUserId);
  const existing = sessionRegistry.get(key);
  if (existing) return existing;
  const session = new P2PConversationSession(config);
  sessionRegistry.set(key, session);
  return session;
}

export function getP2PSession(
  conversationId: string,
  localUserId: string,
): P2PConversationSession | undefined {
  return sessionRegistry.get(sessionKey(conversationId, localUserId));
}
