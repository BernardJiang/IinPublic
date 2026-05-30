import type { Message } from '../../shared/types';
import { P2PSignalingClient, encodeSignalingPayload, type PostSignalingBody } from './p2p-signaling-client';

export type P2PConnectionState = 'idle' | 'connecting' | 'connected' | 'failed';

type SignalPayload =
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; candidate: RTCIceCandidateInit | null };

type DmWirePayload = {
  type: 'dm';
  message: {
    id: string;
    senderId: string;
    text: string;
    timestamp: string;
    channel: string;
    transport: string;
    prevSeen?: string;
    isFromChatbot?: boolean;
  };
};

/** Local/same-machine peers should connect well under this; longer waits usually mean a bug. */
export const P2P_WEBRTC_CONNECT_TIMEOUT_MS = 10_000;

function defaultIceServers(): RTCIceServer[] {
  const custom = typeof process !== 'undefined' ? process.env.E2E_WEBRTC_ICE_SERVERS : undefined;
  if (custom && custom.trim()) {
    try {
      const parsed = JSON.parse(custom) as RTCIceServer[];
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }
  // E2E webpack sets DISABLE_HMR=true — prefer host candidates on one machine.
  if (typeof process !== 'undefined' && process.env.DISABLE_HMR === 'true') {
    return [];
  }
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
  otherUserId: string;
  otherPub: string;
  isInitiator: boolean;
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

  constructor(private config: P2PSessionConfig) {
    this.signaling = new P2PSignalingClient(config.apiBase);
  }

  getState(): P2PConnectionState {
    return this._state;
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

  private setState(state: P2PConnectionState): void {
    this._state = state;
  }

  private async postSignal(kind: PostSignalingBody['kind'], payload: SignalPayload): Promise<void> {
    const body: PostSignalingBody = {
      kind,
      senderPub: this.config.localPub,
      recipientPub: this.config.otherPub,
      signalCiphertext: encodeSignalingPayload(payload),
      signature: `sig_${this.config.localPub}_${Date.now()}`,
      nonce: `nonce_${this.config.localPub}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    await this.signaling.post(this.config.conversationId, body);
  }

  ensureConnected(timeoutMs = P2P_WEBRTC_CONNECT_TIMEOUT_MS): Promise<void> {
    if (this._state === 'connected') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise<void>((resolve, reject) => {
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

    return this.connectPromise;
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
      }).catch(() => undefined);
    };
    this.pc.onconnectionstatechange = () => {
      const cs = this.pc?.connectionState;
      if (cs === 'connected') {
        this.setState('connected');
      } else if (cs === 'failed' || cs === 'closed' || cs === 'disconnected') {
        if (this._state !== 'connected') this.setState('failed');
      }
    };
    this.pc.oniceconnectionstatechange = () => {
      const ice = this.pc?.iceConnectionState;
      if (ice === 'connected' || ice === 'completed') {
        this.setState('connected');
      } else if (ice === 'failed') {
        if (this._state !== 'connected') this.setState('failed');
      }
    };

    if (this.config.isInitiator) {
      this.dc = this.pc.createDataChannel('iinpublic-dm', { ordered: true });
      this.attachDataChannel(this.dc);
      this.makingOffer = true;
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      await this.postSignal('offer', { type: 'offer', sdp: offer });
      this.makingOffer = false;
    } else {
      this.pc.ondatachannel = (event) => {
        this.dc = event.channel;
        this.attachDataChannel(this.dc);
      };
    }
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.setState('connected');
    };
    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as DmWirePayload;
        if (parsed?.type !== 'dm' || !parsed.message) return;
        this.ingestWireMessage(parsed.message);
      } catch {
        // ignore malformed frames
      }
    };
  }

  private ingestWireMessage(wire: DmWirePayload['message']): void {
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
      await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      this.remoteDescriptionSet = true;
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      await this.postSignal('answer', { type: 'answer', sdp: answer });
    } else if (payload.type === 'answer') {
      if (this.config.isInitiator && !this.remoteDescriptionSet) {
        await this.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        this.remoteDescriptionSet = true;
      }
    } else if (payload.type === 'ice' && payload.candidate) {
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
  ): Promise<void> {
    await this.ensureConnected();
    if (!this.dc || this.dc.readyState !== 'open') {
      throw new Error('DataChannel not open');
    }
    const prevSeen =
      this.lastSeenFromOther.get(`${this.config.conversationId}:${senderId}`) ?? undefined;
    const wire = {
      type: 'dm' as const,
      message: {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        senderId,
        text,
        timestamp: new Date().toISOString(),
        channel,
        transport: 'direct-p2p',
        ...(prevSeen !== undefined ? { prevSeen } : {}),
      },
    };
    this.dc.send(JSON.stringify(wire));
    this.ingestWireMessage(wire.message);
  }

  dispose(): void {
    this.stopPolling?.();
    this.stopPolling = null;
    this.dc?.close();
    this.pc?.close();
    this.dc = null;
    this.pc = null;
    this.setState('idle');
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
