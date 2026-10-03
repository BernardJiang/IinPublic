import type { P2PConnectionState } from './p2p-webrtc-session';
import {
  classifySelectedPath,
  generateWifiDirectGroupCredentials,
  joinableCredentials,
  newWifiDirectLinkId,
  parseWifiDirectLinkMessage,
  planWifiDirectLink,
  WIFI_DIRECT_IDLE_TEARDOWN_MS,
  WIFI_DIRECT_PATH_DECISION_DELAY_MS,
  WIFI_DIRECT_RETRY_COOLDOWN_MS,
  WIFI_DIRECT_UPGRADE_TIMEOUT_MS,
  type SelectedCandidatePair,
  type SelectedPathKind,
  type WifiDirectGroupCredentials,
  type WifiDirectLinkMessage,
  type WifiDirectPeerInfo,
  type WifiDirectPlan,
} from '../../shared/wifi-direct-link';

/** Native group state as reported by `WifiDirectGroupController.kt`. */
export type WifiDirectNativeState = {
  state: 'idle' | 'forming' | 'joining' | 'owner' | 'client' | 'failed';
  networkName?: string;
  /** Present only on the owner — the client never re-reads it. */
  passphrase?: string;
  ownerDeviceAddress?: string;
  frequencyMhz?: number;
  ownerIp?: string;
  localIp?: string;
  clientCount?: number;
  reason?: string;
};

export type WifiDirectNativeCapabilities = {
  wifiDirect: boolean;
  /** Android 10+: `WifiP2pConfig.Builder` join without the pairing prompt. */
  joinByCredential: boolean;
  hostScore: number;
};

/** Native boundary (Android bridge in production, fakes in unit tests). */
export interface WifiDirectNative {
  capabilities(): WifiDirectNativeCapabilities;
  requestPermission(): Promise<boolean>;
  createGroup(credentials: WifiDirectGroupCredentials): void;
  joinGroup(credentials: WifiDirectGroupCredentials): void;
  leaveGroup(): void;
  getState(): WifiDirectNativeState;
  onState(listener: (state: WifiDirectNativeState) => void): () => void;
}

/** The subset of `P2PConversationSession` the link service drives. */
export interface LinkableSession {
  readonly otherUserId: string;
  readonly otherPub: string;
  readonly isInitiator: boolean;
  getState(): P2PConnectionState;
  onStateChange(listener: (state: P2PConnectionState) => void): () => void;
  setOnLinkUpgradeMessage(hook: ((message: unknown) => void | Promise<void>) | null): void;
  sendLinkUpgradeMessage(message: unknown): Promise<void>;
  getSelectedCandidatePair(): Promise<SelectedCandidatePair | null>;
  setIceConfigOverride(config: RTCConfiguration | null): void;
  reconnect(timeoutMs?: number): Promise<void>;
}

/** The embedded node's loopback TURN relay (`/api/local-link/relay`), bound to the group address. */
export interface LocalLinkRelay {
  start(groupAddress: string): Promise<RTCIceServer>;
  stop(): Promise<void>;
}

type Phase =
  | 'idle'
  | 'hello-sent'
  | 'forming'
  | 'hosting'
  | 'awaiting-group'
  | 'joining'
  | 'relay-ready'
  | 'switching'
  | 'active'
  | 'cooldown';

type PeerLink = {
  session: LinkableSession;
  phase: Phase;
  linkId: string | null;
  localInfo: WifiDirectPeerInfo | null;
  remoteInfo: WifiDirectPeerInfo | null;
  /** Credentials this peer is joining (client side) — matched against native state. */
  joining: WifiDirectGroupCredentials | null;
  /** Relay-only config through this device's loopback relay, once started. */
  relayConfig: RTCConfiguration | null;
  /** The session runs on `relayConfig` (must be undone if the upgrade fails or the link drops). */
  overrideApplied: boolean;
  localReady: boolean;
  remoteReady: boolean;
  cooldownUntil: number;
  /** Why the last upgrade attempt ended (diagnostics). */
  lastReason: string | null;
  timers: Set<ReturnType<typeof setTimeout>>;
  upgradeTimer: ReturnType<typeof setTimeout> | null;
  unsubscribe: () => void;
};

export type WifiDirectLinkEvent =
  | { type: 'session'; userId: string; state: P2PConnectionState }
  | { type: 'path'; userId: string; path: SelectedPathKind }
  | { type: 'phase'; userId: string; phase: Phase; reason?: string };

export type WifiDirectLinkServiceOptions = {
  localPub: string;
  native: WifiDirectNative;
  localRelay: LocalLinkRelay;
  now?: () => number;
  decisionDelayMs?: number;
  upgradeTimeoutMs?: number;
  retryCooldownMs?: number;
  idleTeardownMs?: number;
  /** Initiator waits this long after `wd-switch` so the responder's fresh connection is listening. */
  switchDelayMs?: number;
  /** Fresh relay-only connection must come up within this. */
  switchTimeoutMs?: number;
  /** Delay between path checks after the switch. */
  verifyDelayMs?: number;
  verifyAttempts?: number;
  onEvent?: (event: WifiDirectLinkEvent) => void;
};

const BUSY_COOLDOWN_MS = 30_000;
/** Collisions and channel blips, not radio failures: retry soon instead of after the long
 *  cooldown (seen on hardware — a boot-time DataChannel blip parked a pair for 10 minutes). */
const TRANSIENT_REASONS = new Set(['busy', 'cooldown', 'send-failed', 'session-lost']);

function isTransientReason(reason: string): boolean {
  return TRANSIENT_REASONS.has(reason.startsWith('remote:') ? reason.slice('remote:'.length) : reason);
}

/**
 * Upgrades non-LAN WebRTC sessions between two Android peers to a Wi-Fi Direct link
 * (TODO OPEN-36). Negotiation runs over the session's own SEA-signed DTLS DataChannel; the hub
 * never sees group credentials. One upgrade runs at a time because Android holds one P2P group.
 */
export class WifiDirectLinkService {
  /** Keyed by session: a mesh and a DM session to the same person each negotiate on their own
   *  channel (the second one finds the group already formed → `already-linked`). */
  private readonly peers = new Map<LinkableSession, PeerLink>();
  private readonly now: () => number;
  private inFlight: PeerLink | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once this service created or joined the current group (so it may remove it). */
  private ownsGroupLifecycle = false;
  private permission: 'unknown' | 'granted' | 'denied' = 'unknown';
  private readonly unsubscribeNative: () => void;
  private disposed = false;

  constructor(private readonly opts: WifiDirectLinkServiceOptions) {
    this.now = opts.now ?? Date.now;
    this.unsubscribeNative = opts.native.onState((state) => this.handleNativeState(state));
  }

  attach(session: LinkableSession): void {
    if (this.disposed || this.peers.has(session)) return;
    const peer: PeerLink = {
      session,
      phase: 'idle',
      linkId: null,
      localInfo: null,
      remoteInfo: null,
      joining: null,
      relayConfig: null,
      overrideApplied: false,
      localReady: false,
      remoteReady: false,
      cooldownUntil: 0,
      lastReason: null,
      timers: new Set(),
      upgradeTimer: null,
      unsubscribe: () => undefined,
    };
    const offState = session.onStateChange((state) => {
      this.opts.onEvent?.({ type: 'session', userId: session.otherUserId, state });
      this.handleSessionState(peer, state);
    });
    this.opts.onEvent?.({ type: 'session', userId: session.otherUserId, state: session.getState() });
    session.setOnLinkUpgradeMessage((message) => this.handleMessage(peer, message));
    peer.unsubscribe = () => { offState(); session.setOnLinkUpgradeMessage(null); };
    this.peers.set(session, peer);
    if (session.getState() === 'connected') this.scheduleEvaluate(peer, this.decisionDelay());
  }

  getPhase(userId: string): Phase | null {
    return [...this.peers.values()].find((peer) => peer.session.otherUserId === userId)?.phase ?? null;
  }

  /** Per-session snapshot for device debugging (`window.__iinpublicWifiDirectLink`). */
  async getDiagnostics(): Promise<Array<{ userId: string; initiator: boolean; session: P2PConnectionState; phase: Phase; path: SelectedPathKind; pair: SelectedCandidatePair | null; lastReason: string | null; cooldownSeconds: number }>> {
    return Promise.all([...this.peers.values()].map(async (peer) => {
      const pair = await peer.session.getSelectedCandidatePair();
      return {
        userId: peer.session.otherUserId,
        initiator: peer.session.isInitiator,
        session: peer.session.getState(),
        phase: peer.phase,
        path: classifySelectedPath(pair),
        pair,
        lastReason: peer.lastReason,
        cooldownSeconds: Math.max(0, Math.round((peer.cooldownUntil - this.now()) / 1000)),
      };
    }));
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeNative();
    for (const peer of this.peers.values()) {
      this.clearTimers(peer);
      peer.unsubscribe();
    }
    this.peers.clear();
    if (this.teardownTimer) clearTimeout(this.teardownTimer);
    this.teardownTimer = null;
    if (this.ownsGroupLifecycle) this.opts.native.leaveGroup();
    this.ownsGroupLifecycle = false;
    void this.opts.localRelay.stop().catch(() => undefined);
  }

  // ── Session events ────────────────────────────────────────────────────────────────────────

  private handleSessionState(peer: PeerLink, state: P2PConnectionState): void {
    // The switch replaces the connection on purpose; `reconnect()`'s promise reports the outcome.
    if (peer.phase === 'switching') return;
    if (state === 'connected') {
      if (peer.phase === 'idle') this.scheduleEvaluate(peer, this.decisionDelay());
      return;
    }
    if (state === 'failed' || state === 'idle') {
      if (peer.phase === 'active') {
        // Link lost: reconnect on the normal ICE servers ourselves — the mesh only retries a dead
        // session when it next sends, so without this the pair stayed down (seen on hardware when
        // the group owner removed the group). Once connected, evaluate() may re-elect a host.
        this.clearOverride(peer);
        this.setPhase(peer, 'idle');
        this.maybeScheduleTeardown();
        if (state === 'failed') void peer.session.reconnect().catch(() => undefined);
      } else if (this.isUpgrading(peer)) {
        this.fail(peer, 'session-lost', { notify: false });
      }
    }
  }

  private scheduleEvaluate(peer: PeerLink, delayMs: number): void {
    this.later(peer, delayMs, () => { void this.evaluate(peer); });
  }

  private async evaluate(peer: PeerLink): Promise<void> {
    if (this.disposed || peer.phase !== 'idle' && peer.phase !== 'cooldown') return;
    if (peer.session.getState() !== 'connected') return;
    if (peer.phase === 'cooldown') {
      if (this.now() < peer.cooldownUntil) return;
      this.setPhase(peer, 'idle');
    }
    const path = classifySelectedPath(await peer.session.getSelectedCandidatePair());
    this.opts.onEvent?.({ type: 'path', userId: peer.session.otherUserId, path });
    if (path === 'lan' || path === 'wifi-direct') return;
    if (path === 'unknown') {
      this.scheduleEvaluate(peer, this.decisionDelay());
      return;
    }
    if (!this.opts.native.capabilities().wifiDirect) return;
    if (this.inFlight && this.inFlight !== peer) {
      this.scheduleEvaluate(peer, 5_000);
      return;
    }
    if (!(await this.ensurePermission())) return;
    if (peer.phase !== 'idle' || peer.session.getState() !== 'connected') return;
    this.beginUpgrade(peer, newWifiDirectLinkId());
    await this.send(peer, { v: 1, kind: 'wd-hello', linkId: peer.linkId!, info: peer.localInfo! });
  }

  private async ensurePermission(): Promise<boolean> {
    if (this.permission === 'unknown') {
      this.permission = (await this.opts.native.requestPermission().catch(() => false)) ? 'granted' : 'denied';
    }
    return this.permission === 'granted';
  }

  private beginUpgrade(peer: PeerLink, linkId: string): void {
    this.inFlight = peer;
    peer.linkId = linkId;
    peer.localInfo = this.localInfo();
    peer.remoteInfo = null;
    peer.joining = null;
    peer.localReady = false;
    peer.remoteReady = false;
    this.setPhase(peer, 'hello-sent');
    if (peer.upgradeTimer) clearTimeout(peer.upgradeTimer);
    peer.upgradeTimer = setTimeout(() => this.fail(peer, 'timeout'), this.opts.upgradeTimeoutMs ?? WIFI_DIRECT_UPGRADE_TIMEOUT_MS);
    if (this.teardownTimer) { clearTimeout(this.teardownTimer); this.teardownTimer = null; }
  }

  private localInfo(): WifiDirectPeerInfo {
    const caps = this.opts.native.capabilities();
    const state = this.opts.native.getState();
    const info: WifiDirectPeerInfo = {
      canHost: caps.wifiDirect,
      joinByCredential: caps.joinByCredential,
      hostScore: Math.max(0, Math.min(3, Math.round(caps.hostScore))),
    };
    const group = this.currentGroupCredentials(state);
    if (group) info.group = group;
    return info;
  }

  /** Joinable credentials for the group this device is in — owner reads them from native; a
   *  client re-shares what it joined with (native does not expose the passphrase to clients). */
  private currentGroupCredentials(state: WifiDirectNativeState): (WifiDirectGroupCredentials & { role: 'owner' | 'client' }) | null {
    if (state.state === 'owner' && state.networkName && state.passphrase) {
      return { role: 'owner', ...ownerCredentials(state) };
    }
    if (state.state === 'client' && state.networkName) {
      // Re-share only while a link over the group is live: Android keeps reporting "client" for a
      // while after the owner removes the group, and re-sharing those dead credentials sent a third
      // phone scanning for a group that no longer existed (seen on hardware).
      const groupAlive = [...this.peers.values()].some((peer) => peer.phase === 'active');
      const joined = [...this.peers.values()].find((peer) => peer.joining?.networkName === state.networkName)?.joining;
      if (joined && groupAlive) return { role: 'client', ...joined };
    }
    return null;
  }

  // ── Link protocol ─────────────────────────────────────────────────────────────────────────

  private async handleMessage(peer: PeerLink, raw: unknown): Promise<void> {
    if (this.disposed) return;
    const message = parseWifiDirectLinkMessage(raw);
    if (!message) return;
    switch (message.kind) {
      case 'wd-hello': return this.handleHello(peer, message);
      case 'wd-group': return this.handleGroup(peer, message);
      case 'wd-joined':
        if (message.linkId === peer.linkId && peer.phase === 'hosting') await this.afterLinked(peer);
        return;
      case 'wd-ready':
        if (message.linkId === peer.linkId && this.isUpgrading(peer)) {
          peer.remoteReady = true;
          this.maybeSwitch(peer);
        }
        return;
      case 'wd-switch':
        if (message.linkId === peer.linkId && peer.phase === 'relay-ready' && !peer.session.isInitiator && peer.localReady) this.switchToRelay(peer);
        return;
      case 'wd-active':
        return;
      case 'wd-abort':
        if (message.linkId === peer.linkId && this.isUpgrading(peer)) this.fail(peer, `remote:${message.reason}`, { notify: false });
        return;
    }
  }

  private async handleHello(peer: PeerLink, message: Extract<WifiDirectLinkMessage, { kind: 'wd-hello' }>): Promise<void> {
    const abort = (reason: string) => this.send(peer, { v: 1, kind: 'wd-abort', linkId: message.linkId, reason });
    if (!this.opts.native.capabilities().wifiDirect) return abort('unsupported');
    if (peer.phase === 'idle' || peer.phase === 'cooldown' || peer.phase === 'active') {
      if (peer.phase === 'cooldown' && this.now() < peer.cooldownUntil) return abort('cooldown');
      if (this.inFlight && this.inFlight !== peer) return abort('busy');
      if (!(await this.ensurePermission())) return abort('permission-denied');
      this.beginUpgrade(peer, message.linkId);
      peer.remoteInfo = message.info;
      await this.send(peer, { v: 1, kind: 'wd-hello', linkId: message.linkId, info: peer.localInfo! });
      return this.executePlan(peer);
    }
    if (peer.phase !== 'hello-sent' || peer.remoteInfo) return;
    // Both sides opened concurrently: converge on the smaller linkId.
    if (peer.linkId && message.linkId < peer.linkId) peer.linkId = message.linkId;
    peer.remoteInfo = message.info;
    return this.executePlan(peer);
  }

  private async executePlan(peer: PeerLink): Promise<void> {
    if (!peer.localInfo || !peer.remoteInfo) return;
    const plan: WifiDirectPlan = await planWifiDirectLink({
      localPub: this.opts.localPub,
      remotePub: peer.session.otherPub,
      local: peer.localInfo,
      remote: peer.remoteInfo,
    });
    if (!this.isUpgrading(peer)) return;
    switch (plan.action) {
      case 'abort':
        return this.fail(peer, plan.reason);
      case 'already-linked':
        return this.afterLinked(peer);
      case 'await-group':
        this.setPhase(peer, 'awaiting-group');
        return;
      case 'join':
        return this.join(peer, plan.credentials);
      case 'host': {
        const state = this.opts.native.getState();
        const existing = this.currentGroupCredentials(state);
        if (plan.reuseExisting && existing) {
          this.setPhase(peer, 'hosting');
          await this.send(peer, { v: 1, kind: 'wd-group', linkId: peer.linkId!, credentials: withoutRole(existing) });
          return;
        }
        this.setPhase(peer, 'forming');
        this.ownsGroupLifecycle = true;
        this.opts.native.createGroup(generateWifiDirectGroupCredentials());
        return;
      }
    }
  }

  private async handleGroup(peer: PeerLink, message: Extract<WifiDirectLinkMessage, { kind: 'wd-group' }>): Promise<void> {
    if (message.linkId !== peer.linkId || peer.phase !== 'awaiting-group') return;
    await this.join(peer, message.credentials);
  }

  private async join(peer: PeerLink, credentials: WifiDirectGroupCredentials): Promise<void> {
    peer.joining = credentials;
    const state = this.opts.native.getState();
    if (state.state === 'client' && state.networkName === credentials.networkName) {
      await this.send(peer, { v: 1, kind: 'wd-joined', linkId: peer.linkId! });
      return this.afterLinked(peer);
    }
    this.setPhase(peer, 'joining');
    this.ownsGroupLifecycle = true;
    this.opts.native.joinGroup(credentials);
  }

  /**
   * Both ends are in the group. Android WebView never gathers ICE candidates on the group
   * interface, so each side starts its loopback TURN relay (relay socket on the group address) and
   * says `wd-ready`; then both switch the session to a fresh relay-only connection (`wd-switch`).
   */
  private async afterLinked(peer: PeerLink): Promise<void> {
    if (!this.isUpgrading(peer) || peer.phase === 'relay-ready' || peer.phase === 'switching') return;
    this.setPhase(peer, 'relay-ready');
    const groupAddress = this.opts.native.getState().localIp;
    if (!groupAddress) return this.fail(peer, 'no-group-address');
    try {
      const server = await this.opts.localRelay.start(groupAddress);
      if ((peer.phase as Phase) !== 'relay-ready') return; // failed/timed out while starting
      peer.relayConfig = { iceServers: [server], iceTransportPolicy: 'relay' };
    } catch {
      return this.fail(peer, 'relay-start-failed');
    }
    peer.localReady = true;
    await this.send(peer, { v: 1, kind: 'wd-ready', linkId: peer.linkId! });
    this.maybeSwitch(peer);
  }

  /**
   * Initiator: once both relays are up, tell the responder to switch, then switch itself. It enters
   * `switching` right away — the responder drops the old connection first, which is expected.
   */
  private maybeSwitch(peer: PeerLink): void {
    if (peer.phase !== 'relay-ready' || !peer.localReady || !peer.remoteReady || !peer.session.isInitiator) return;
    void this.send(peer, { v: 1, kind: 'wd-switch', linkId: peer.linkId! });
    this.setPhase(peer, 'switching');
    // The responder's fresh connection must be listening before the initiator's offer goes out.
    this.later(peer, this.opts.switchDelayMs ?? 1_000, () => this.switchToRelay(peer));
  }

  /**
   * Replace the session's connection with a relay-only one. An ICE restart on the live connection
   * does not work: Chrome keeps the old pair and never checks the new relay pairs.
   */
  private switchToRelay(peer: PeerLink): void {
    if ((peer.phase !== 'relay-ready' && peer.phase !== 'switching') || !peer.relayConfig || peer.overrideApplied) return;
    this.setPhase(peer, 'switching');
    peer.session.setIceConfigOverride(peer.relayConfig);
    peer.overrideApplied = true;
    peer.session.reconnect(this.opts.switchTimeoutMs ?? 15_000)
      .then(() => this.verifyPath(peer, 1))
      .catch(() => this.fail(peer, 'switch-failed', { notify: false }));
  }

  private async verifyPath(peer: PeerLink, attempt: number): Promise<void> {
    if (peer.phase !== 'switching') return;
    const path = classifySelectedPath(await peer.session.getSelectedCandidatePair());
    this.opts.onEvent?.({ type: 'path', userId: peer.session.otherUserId, path });
    if (path === 'wifi-direct') {
      this.finishUpgrade(peer, 'active');
      await this.send(peer, { v: 1, kind: 'wd-active', linkId: peer.linkId! });
      return;
    }
    if (attempt >= (this.opts.verifyAttempts ?? 3)) return this.fail(peer, `path-not-upgraded:${path}`);
    this.later(peer, this.opts.verifyDelayMs ?? 1_000, () => { void this.verifyPath(peer, attempt + 1); });
  }

  // ── Native events ─────────────────────────────────────────────────────────────────────────

  private handleNativeState(state: WifiDirectNativeState): void {
    if (this.disposed) return;
    for (const peer of this.peers.values()) {
      if (peer.phase === 'forming') {
        if (state.state === 'owner' && state.networkName && state.passphrase) {
          this.setPhase(peer, 'hosting');
          void this.send(peer, {
            v: 1,
            kind: 'wd-group',
            linkId: peer.linkId!,
            credentials: ownerCredentials(state),
          });
        } else if (state.state === 'failed' || state.state === 'client') {
          this.fail(peer, `create-group:${state.reason ?? state.state}`);
        }
      } else if (peer.phase === 'joining') {
        if (state.state === 'client' && state.networkName === peer.joining?.networkName) {
          void this.send(peer, { v: 1, kind: 'wd-joined', linkId: peer.linkId! }).then(() => this.afterLinked(peer));
        } else if (state.state === 'failed') {
          this.fail(peer, `join-group:${state.reason ?? 'failed'}`);
        }
      } else if (peer.phase === 'active' && (state.state === 'idle' || state.state === 'failed')) {
        // Group gone: the relay-only connection is dead too. This event usually arrives before the
        // session notices, so drop the override and reconnect on normal ICE now — otherwise the
        // pair stayed failed (seen on hardware). evaluate() then re-elects a host.
        this.clearOverride(peer);
        this.setPhase(peer, 'idle');
        void peer.session.reconnect().catch(() => undefined);
      }
    }
    if (state.state === 'idle' || state.state === 'failed') {
      this.ownsGroupLifecycle = false;
      void this.opts.localRelay.stop().catch(() => undefined);
    }
  }

  // ── Lifecycle helpers ─────────────────────────────────────────────────────────────────────

  private isUpgrading(peer: PeerLink): boolean {
    return ['hello-sent', 'forming', 'hosting', 'awaiting-group', 'joining', 'relay-ready', 'switching'].includes(peer.phase);
  }

  private finishUpgrade(peer: PeerLink, phase: 'active' | 'cooldown', reason?: string): void {
    if (peer.upgradeTimer) clearTimeout(peer.upgradeTimer);
    peer.upgradeTimer = null;
    if (this.inFlight === peer) this.inFlight = null;
    this.setPhase(peer, phase, reason);
  }

  private fail(peer: PeerLink, reason: string, options: { notify?: boolean } = {}): void {
    if (!this.isUpgrading(peer)) return;
    const linkId = peer.linkId;
    peer.lastReason = reason;
    peer.cooldownUntil = this.now() + (isTransientReason(reason) ? BUSY_COOLDOWN_MS : this.opts.retryCooldownMs ?? WIFI_DIRECT_RETRY_COOLDOWN_MS);
    this.clearTimers(peer);
    this.finishUpgrade(peer, 'cooldown', reason);
    if (this.clearOverride(peer) && peer.session.getState() !== 'connected') {
      // The relay-only connection is gone or never came up: reconnect on the normal ICE servers.
      void peer.session.reconnect().catch(() => undefined);
    }
    if (options.notify !== false && linkId) void this.send(peer, { v: 1, kind: 'wd-abort', linkId, reason: reason.slice(0, 64) });
    this.maybeScheduleTeardown();
    this.scheduleEvaluate(peer, Math.max(0, peer.cooldownUntil - this.now()));
  }

  /** Leave/remove the group once no peer is linked or mid-upgrade over it. */
  private maybeScheduleTeardown(): void {
    if (!this.ownsGroupLifecycle || this.teardownTimer) return;
    const busy = [...this.peers.values()].some((peer) => peer.phase === 'active' || this.isUpgrading(peer));
    if (busy) return;
    this.teardownTimer = setTimeout(() => {
      this.teardownTimer = null;
      const stillBusy = [...this.peers.values()].some((peer) => peer.phase === 'active' || this.isUpgrading(peer));
      if (stillBusy || !this.ownsGroupLifecycle) return;
      this.ownsGroupLifecycle = false;
      this.opts.native.leaveGroup();
      void this.opts.localRelay.stop().catch(() => undefined);
    }, this.opts.idleTeardownMs ?? WIFI_DIRECT_IDLE_TEARDOWN_MS);
  }

  /** Drop the relay-only override so the session's next connection uses normal ICE servers. */
  private clearOverride(peer: PeerLink): boolean {
    peer.relayConfig = null;
    if (!peer.overrideApplied) return false;
    peer.overrideApplied = false;
    peer.session.setIceConfigOverride(null);
    return true;
  }

  private setPhase(peer: PeerLink, phase: Phase, reason?: string): void {
    if (peer.phase === phase) return;
    peer.phase = phase;
    this.opts.onEvent?.({ type: 'phase', userId: peer.session.otherUserId, phase, ...(reason ? { reason } : {}) });
  }

  private async send(peer: PeerLink, message: WifiDirectLinkMessage): Promise<void> {
    try {
      await peer.session.sendLinkUpgradeMessage(message);
    } catch {
      if (message.kind !== 'wd-abort') this.fail(peer, 'send-failed', { notify: false });
    }
  }

  private later(peer: PeerLink, delayMs: number, fn: () => void): void {
    const timer = setTimeout(() => { peer.timers.delete(timer); fn(); }, delayMs);
    peer.timers.add(timer);
  }

  private clearTimers(peer: PeerLink): void {
    for (const timer of peer.timers) clearTimeout(timer);
    peer.timers.clear();
    if (peer.upgradeTimer) clearTimeout(peer.upgradeTimer);
    peer.upgradeTimer = null;
  }

  private decisionDelay(): number {
    return this.opts.decisionDelayMs ?? WIFI_DIRECT_PATH_DECISION_DELAY_MS;
  }
}

function withoutRole(group: WifiDirectGroupCredentials & { role?: unknown }): WifiDirectGroupCredentials {
  return joinableCredentials(group);
}

/** Owner-side credentials from native state (caller checked networkName + passphrase). */
function ownerCredentials(state: WifiDirectNativeState): WifiDirectGroupCredentials {
  return joinableCredentials({
    networkName: state.networkName ?? '',
    passphrase: state.passphrase ?? '',
    ...(state.ownerDeviceAddress ? { ownerDeviceAddress: state.ownerDeviceAddress } : {}),
    ...(state.frequencyMhz ? { frequencyMhz: state.frequencyMhz } : {}),
  });
}
