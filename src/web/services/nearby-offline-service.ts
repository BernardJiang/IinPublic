import {
  encodeBlePresence,
  encodeNearbyTxt,
  deriveOfflineGroupCredentials,
  OFFLINE_GROUP_NAME_PREFIX,
  lanGunPeerUrl,
  NEARBY_LAN_TTL_MS,
  NEARBY_RECORD_TTL_MS,
  parseBlePresence,
  parseNearbyTxt,
  planOfflineGroup,
  planWifiOnlyFallback,
  type WifiDirectPeerSighting,
  type WifiOnlyPlan,
  rotatingNearbyId,
  verifyNearbyTxtProof,
  type NearbyRecord,
  type OfflineGroupPlan,
} from '../../shared/nearby-offline';
import {
  DiscoveryPolicy,
  discoveryProviderAvailability,
  NearbyCandidateRegistry,
  type DiscoveryPolicyDecision,
  type DiscoveryReadiness,
  type DiscoveryStage,
} from '../../shared/nearby-discovery-policy';
import type { ActiveRoomScope } from '../../shared/active-exchange-room';
import { joinableCredentials } from '../../shared/wifi-direct-link';
import type { LocalLinkRelay, WifiDirectNative, WifiDirectNativeState } from './wifi-direct-link-service';

/** Offline-discovery methods on `window.IinPublicNearby` (NearbyJavascriptBridge.kt). */
export type NearbyOfflineBridge = {
  setNearbyExchangeMode?(mode: 'off' | 'while-open' | 'always', roomId: string): void;
  startLanDiscovery(port: number, nearbyId: string, roomTokenPrefix: string): void;
  stopLanDiscovery(): void;
  advertiseWifiDirectService(txtJson: string): void;
  startWifiDirectServiceDiscovery(): void;
  stopWifiDirectServiceDiscovery(): void;
  nearbyReadiness(): string;
  /** Android active-network health and NET_CAPABILITY_NOT_METERED; never contains SSID. */
  networkPathState?(): string;
  openNearbySettings(kind: string): void;
  /** `scan` false once in a group: keep advertising (newcomers find us), stop scanning (battery). */
  startBlePresence(payloadHex: string, scan: boolean): void;
  stopBlePresence(): void;
  requestOfflineNearbyPermission(): void;
  /** Re-read a group Android kept from an earlier process; the answer arrives as a state event. */
  refreshWifiDirectState?(): void;
};

export type NearbyReadiness = {
  /** Wi-Fi Direct and BLE runtime permissions (one "Nearby devices" prompt on Android 12+). */
  permission: boolean;
  wifiEnabled: boolean;
  locationEnabled: boolean;
  bluetoothEnabled: boolean;
};

export type NearbyStatus =
  /** Online: the hub is reachable, Wi-Fi Direct is not needed. */
  | { kind: 'standby'; lanPhones: number }
  | { kind: 'off'; lanPhones: number }
  | { kind: 'searching'; lanPhones: number }
  /** Offline and nobody found: beacon only, the next scan window is backed off. */
  | { kind: 'quiet'; lanPhones: number; nextScanInSeconds: number }
  /** `online`: this phone reaches the hub and links with offline nearby phones to exchange Talks. */
  | { kind: 'wifi-direct'; online: boolean; hosting: boolean; phones: number | null; lanPhones: number };

export type NearbyReadinessGap = 'permission' | 'wifi' | 'location' | 'bluetooth';

export type NearbyOfflineEvent =
  | { type: 'lan-peer'; url: string }
  | { type: 'wd-record'; id: string; hosting: boolean; via: 'ble' | 'dns-sd' }
  | { type: 'plan'; plan: OfflineGroupPlan }
  | { type: 'fallback'; plan: WifiOnlyPlan }
  | { type: 'group'; state: WifiDirectNativeState['state']; localIp?: string; ownerIp?: string }
  | { type: 'wifi-direct'; active: boolean; reason?: string }
  | { type: 'stale-group-left'; networkName: string }
  | { type: 'stage'; stage: DiscoveryStage; lanNsd: boolean; bleScan: boolean; wifiDirectDiscovery: boolean };

export type NearbyOfflineServiceOptions = {
  localPub: string;
  /** Current authenticated room capability. Nearby exchange fails closed without it. */
  getRoomScope: () => ActiveRoomScope | null;
  /** Port of this phone's embedded node; peers' ports come from their records. */
  port: number;
  bridge: NearbyOfflineBridge;
  native: WifiDirectNative;
  localRelay: LocalLinkRelay;
  addGunPeer: (url: string) => void;
  setLocalLinkIceServer: (server: RTCIceServer | null) => void;
  /** The hub is reachable over a path the policy allows for discovery (Internet switch, metering). */
  hubReachable: () => Promise<boolean>;
  /**
   * The other members of the active room's signed roster: how many, and their SEA pubs. Drives LAN
   * NSD (silent for a lone user) and binds rotating radio ids to identities. Omitted or null =
   * unknown, and LAN discovery stays on.
   */
  getRoomPeers?: () => { count: number; pubs: readonly string[] } | null;
  /** Wi-Fi Direct + BLE permissions, asked in context the first time the phone is offline. */
  requestPermission: () => Promise<boolean>;
  /** False when the user explicitly turned Wi-Fi Direct off. */
  wifiDirectAllowed: boolean;
  /** The LAN provider switch (and `?nearby_lan=0` for device testing). */
  lanDiscovery?: boolean;
  /** Device testing only (`?nearby_ble=0`): skip BLE presence to exercise the Wi-Fi-only paths. */
  blePresence?: boolean;
  onReadinessGap?: (gap: NearbyReadinessGap) => void;
  onEvent?: (event: NearbyOfflineEvent) => void;
  events?: EventTarget;
  now?: () => number;
  random?: () => number;
  tickMs?: number;
};

/** After a failed create/join, wait before planning again. */
const GROUP_RETRY_MS = 20_000;
/** A join gets the native join timeout (hinted 35 s + unhinted retry) before replanning. */
const JOIN_WAIT_MS = 75_000;
const CREATE_WAIT_MS = 20_000;
/** An owner with no clients this long removes its group. */
const EMPTY_GROUP_TEARDOWN_MS = 3 * 60_000;
/** Back online this long: the offline group is no longer needed and is left. */
const ONLINE_LEAVE_GROUP_MS = 60_000;
/** A group owner whose fixed-credential join failed is not an IinPublic group (or out of range). */
const FALLBACK_OWNER_COOLDOWN_MS = 5 * 60_000;

/**
 * OPEN-36 offline mode (see `src/shared/nearby-offline.ts`), driven by the staged
 * `DiscoveryPolicy` (`src/shared/nearby-discovery-policy.ts`):
 * - LAN NSD peers the page's Gun with other phones' nodes, but only while the active room has
 *   another member or the hub is unavailable — a lone online user stays silent.
 * - The BLE beacon advertises whenever Bluetooth is on (and, online, already permitted); scans are
 *   duty-cycled with a quiet-singleton backoff.
 * - Wi-Fi Direct is network-free: offline it runs in scan windows; online it stays idle until an
 *   OFFLINE same-room phone needs a link so the two can exchange Talks (bridging that phone on to
 *   the hub is deferred). A group
 *   forms only for a proof-verified (or roster-bound) same-room phone the LAN does not reach.
 * Every sighting goes through one `NearbyCandidateRegistry`, so a phone seen over LAN, BLE and
 * DNS-SD (and across id rotations) is one logical peer.
 */
export class NearbyOfflineService {
  private readonly now: () => number;
  private readonly events: EventTarget;
  private id = '';
  private readonly registry = new NearbyCandidateRegistry({ ttlMs: NEARBY_RECORD_TTL_MS * 2, lanTtlMs: NEARBY_LAN_TTL_MS });
  private readonly policy = new DiscoveryPolicy();
  private lastDecision: DiscoveryPolicyDecision | null = null;
  private lanRunning = false;
  private lanAllowed: boolean;
  private bleState = '';
  private readonly peeredUrls = new Set<string>();
  /** LAN phones seen over NSD. Gun-peered only while the hub is unreachable (see `peerLanPhones`). */
  private readonly lanUrls = new Set<string>();
  /** Hub reachability from the last tick; null before the first. */
  private hubOnline: boolean | null = null;
  private wifiDirectActive = false;
  private permissionDenied = false;
  private reportedGaps = new Set<NearbyReadinessGap>();
  private lastAdvertised = '';
  private busyUntil = 0;
  private ownsGroup = false;
  private joinedRecord: NearbyRecord | null = null;
  private relayAddress: string | null = null;
  private emptySince: number | null = null;
  private lastPlan: OfflineGroupPlan | null = null;
  private lastFallback: WifiOnlyPlan['action'] = 'none';
  private readonly wdPeers = new Map<string, WifiDirectPeerSighting>();
  private readonly ownerCooldown = new Map<string, number>();
  private phonesSince: number | null = null;
  private fallbackJoinAddress: string | null = null;
  private hostDelayMs = 30_000;
  private onlineSince: number | null = null;
  private wifiDirectAllowed: boolean;
  /** Native re-sends its state with every discovery error; act on transitions only. */
  private lastGroupState: WifiDirectNativeState['state'] = 'idle';
  private blePresence: boolean;
  private leaveDelayMs = 20_000;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private unsubscribeNative: (() => void) | null = null;
  private disposed = false;

  private readonly candidateEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{
      source?: unknown;
      transportId?: unknown;
      endpoint?: unknown;
      capabilities?: unknown;
    }>).detail;
    if (detail?.source !== 'mdns') return;
    const url = lanGunPeerUrl(detail.endpoint);
    const peerId = typeof detail.transportId === 'string' ? detail.transportId : '';
    const roomToken = this.opts.getRoomScope()?.roomToken;
    const capabilities = Array.isArray(detail.capabilities) ? detail.capabilities.map(String) : [];
    const advertisedRoomPrefix = capabilities.find((value) => value.startsWith('room-token:'))?.slice('room-token:'.length) || '';
    // Never peer with ourselves (a resolve without TXT falls back to the service name).
    if (!url || !peerId || !roomToken || !/^[a-f0-9]{8}$/.test(advertisedRoomPrefix)
      || !roomToken.startsWith(advertisedRoomPrefix)
      || peerId === this.id || peerId.endsWith(`-${this.id}`)) return;
    this.registry.observe({ source: 'lan', discoveryId: peerId.slice(-12), seenAt: this.now(), roomVerified: false, route: url });
    this.lanUrls.add(url);
    this.peerLanPhones();
  };

  /**
   * Direct Gun links to LAN phones only while the hub is unreachable. Online, every LAN phone is
   * already reached through the hub, and a full LAN mesh on top floods each write between every
   * pair: on four phones it slowed Talk delivery from ~12 s to minutes and lost the backgrounded
   * receiver's Talk (native-app/30, 2026-10-11). NSD keeps running online as proximity evidence.
   */
  private peerLanPhones(): void {
    if (this.hubOnline !== false) return;
    for (const url of this.lanUrls) {
      if (this.peeredUrls.has(url)) continue;
      this.peeredUrls.add(url);
      this.opts.addGunPeer(url);
      this.opts.onEvent?.({ type: 'lan-peer', url });
    }
  }

  private readonly serviceEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ txt?: unknown; deviceAddress?: unknown }>).detail;
    const record = parseNearbyTxt(detail?.txt, this.now(), typeof detail?.deviceAddress === 'string' ? detail.deviceAddress : undefined);
    const roomToken = this.opts.getRoomScope()?.roomToken;
    if (!record || !roomToken || !record.roomToken || !roomToken.startsWith(record.roomToken) || record.id === this.id) return;
    if (record.hostingHint) record.group = deriveOfflineGroupCredentials(this.opts.getRoomScope()!);
    record.roomVerified = verifyNearbyTxtProof(record, roomToken);
    this.observeRecord(record, 'dns-sd');
  };

  private readonly peersEvent = (event: Event): void => {
    const peers = (event as CustomEvent<{ peers?: unknown }>).detail?.peers;
    if (!Array.isArray(peers)) return;
    const now = this.now();
    for (const raw of peers) {
      const peer = raw as { address?: unknown; groupOwner?: unknown; type?: unknown };
      if (typeof peer.address !== 'string' || !/^[0-9a-f:]{17}$/i.test(peer.address)) continue;
      this.wdPeers.set(peer.address.toLowerCase(), {
        address: peer.address.toLowerCase(),
        groupOwner: peer.groupOwner === true,
        type: typeof peer.type === 'string' ? peer.type : '',
        seenAt: now,
      });
    }
  };

  private readonly bleEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ payload?: unknown }>).detail;
    const roomToken = this.opts.getRoomScope()?.roomToken;
    const record = roomToken ? parseBlePresence(detail?.payload, this.now(), this.opts.port, roomToken) : null;
    if (!record || record.id === this.id) return;
    this.observeRecord(record, 'ble');
  };

  private observeRecord(record: NearbyRecord, via: 'ble' | 'dns-sd'): void {
    const previous = this.registry.list(this.now()).find((peer) => peer.discoveryIds.includes(record.id))?.record;
    const peer = this.registry.observe({
      source: via,
      discoveryId: record.id,
      seenAt: record.seenAt,
      roomVerified: record.roomVerified === true,
      ...(record.deviceAddress ? { route: record.deviceAddress } : {}),
      record,
    });
    if (!previous || !!previous.group !== !!record.group) {
      this.opts.onEvent?.({ type: 'wd-record', id: record.id, hosting: !!peer.record?.group, via });
    }
  }

  constructor(private readonly opts: NearbyOfflineServiceOptions) {
    this.wifiDirectAllowed = opts.wifiDirectAllowed;
    this.blePresence = opts.blePresence !== false;
    this.lanAllowed = opts.lanDiscovery !== false;
    this.now = opts.now ?? Date.now;
    this.events = opts.events ?? window;
  }

  async start(): Promise<void> {
    const scope = this.opts.getRoomScope();
    if (!scope) throw new Error('active room scope is required for nearby exchange');
    this.id = await rotatingNearbyId(this.opts.localPub, this.now(), scope.roomToken);
    if (this.disposed) return;
    this.events.addEventListener('iinpublic-nearby-candidate', this.candidateEvent);
    this.events.addEventListener('iinpublic-nearby-wd-service', this.serviceEvent);
    this.events.addEventListener('iinpublic-nearby-ble', this.bleEvent);
    this.events.addEventListener('iinpublic-nearby-wd-peers', this.peersEvent);
    this.unsubscribeNative = this.opts.native.onState((state) => { void this.handleGroupState(state); });
    this.timer = setInterval(() => { void this.tick(); }, this.opts.tickMs ?? 5_000);
    // A group left over from before a restart (Android keeps it) still needs its relay and peer —
    // and must not be re-created by the planner, which would drop its clients.
    this.opts.bridge.refreshWifiDirectState?.();
    await this.handleGroupState(this.opts.native.getState());
    await this.tick();
  }

  /**
   * The user's Settings switches (both on by default). Wi-Fi Direct off: stop scanning and leave the
   * offline group right away. Bluetooth off: stop the presence beacon; Wi-Fi discovery remains.
   */
  updateSettings(settings: { wifiDirect: boolean; bluetooth: boolean; lan?: boolean }): void {
    this.blePresence = settings.bluetooth;
    this.wifiDirectAllowed = settings.wifiDirect;
    if (settings.lan !== undefined) this.lanAllowed = settings.lan;
    this.policy.reset();
    if (!settings.lan && settings.lan !== undefined) this.applyLan(false);
    if (!settings.bluetooth) this.applyBle(false, false);
    if (!settings.wifiDirect) {
      const state = this.opts.native.getState();
      if ((state.state === 'owner' || state.state === 'client') && state.networkName === this.currentCredentials()?.networkName) {
        this.ownsGroup = false;
        this.opts.native.leaveGroup();
      }
      if (this.wifiDirectActive) this.stopWifiDirect('disabled-in-settings');
    }
    void this.tick();
  }

  /** Room change or an explicit retry: forget the quiet-singleton backoff. */
  resetDiscoveryBackoff(): void {
    this.policy.reset();
    void this.tick();
  }

  /** Plain-language state for the Settings screen. */
  getStatus(): NearbyStatus {
    const state = this.opts.native.getState();
    const lanPhones = this.lanUrls.size;
    if ((state.state === 'owner' || state.state === 'client') && state.networkName === this.currentCredentials()?.networkName) {
      return {
        kind: 'wifi-direct',
        online: this.isOnlineStage(),
        hosting: state.state === 'owner',
        // Only the host knows how many phones joined.
        phones: state.state === 'owner' ? state.clientCount ?? 0 : null,
        lanPhones,
      };
    }
    if (!this.wifiDirectAllowed) return { kind: 'off', lanPhones };
    if (this.lastDecision?.stage === 'offline-quiet') {
      return { kind: 'quiet', lanPhones, nextScanInSeconds: Math.max(0, Math.round((this.lastDecision.nextReviewAt - this.now()) / 1000)) };
    }
    if (this.wifiDirectActive || this.lastDecision?.stage === 'offline-searching' || this.lastDecision?.stage === 'offline-peers') {
      return { kind: 'searching', lanPhones };
    }
    return { kind: 'standby', lanPhones };
  }

  getDiagnostics(): Record<string, unknown> {
    const now = this.now();
    const nativeState = this.opts.native.getState();
    // The Android owner state contains the active group passphrase, and a join plan contains both
    // that credential and the full room capability used to derive it. Diagnostics are commonly
    // attached to E2E failures and copied into support reports, so expose only routing/status data.
    const { passphrase: _passphrase, ...safeGroupState } = nativeState;
    const safeLastPlan = this.lastPlan?.action === 'join'
      ? {
        action: 'join',
        record: {
          id: this.lastPlan.record.id,
          port: this.lastPlan.record.port,
          joinByCredential: this.lastPlan.record.joinByCredential,
          hostScore: this.lastPlan.record.hostScore,
          hosting: true,
          ...(this.lastPlan.record.deviceAddress ? { deviceAddress: this.lastPlan.record.deviceAddress } : {}),
        },
      }
      : this.lastPlan;
    return {
      id: this.id,
      lanPeers: [...this.registry.lanIds(now)],
      gunPeers: [...this.peeredUrls],
      wifiDirectActive: this.wifiDirectActive,
      permissionDenied: this.permissionDenied,
      stage: this.lastDecision?.stage ?? null,
      lanNsd: this.lanRunning,
      backoff: this.policy.getBackoffState(),
      // One row per logical peer: sightings over LAN/BLE/DNS-SD and across id rotations merge.
      peers: this.registry.list(now).map((peer) => ({
        ids: peer.discoveryIds,
        identityBound: !!peer.seaPub,
        eligible: peer.eligible,
        onLan: peer.onLan,
        sources: peer.sources,
        hosting: !!peer.record?.group,
        ageSeconds: Math.round((now - peer.lastSeenAt) / 1000),
      })),
      group: safeGroupState,
      relayAddress: this.relayAddress,
      lastPlan: safeLastPlan,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.events.removeEventListener('iinpublic-nearby-candidate', this.candidateEvent);
    this.events.removeEventListener('iinpublic-nearby-wd-service', this.serviceEvent);
    this.events.removeEventListener('iinpublic-nearby-ble', this.bleEvent);
    this.events.removeEventListener('iinpublic-nearby-wd-peers', this.peersEvent);
    this.unsubscribeNative?.();
    this.opts.bridge.stopLanDiscovery();
    this.lanRunning = false;
    if (this.wifiDirectActive) this.opts.bridge.stopWifiDirectServiceDiscovery();
    if (this.wifiDirectActive || this.bleState) this.opts.bridge.stopBlePresence();
    this.bleState = '';
    if (this.ownsGroup) this.opts.native.leaveGroup();
    this.opts.setLocalLinkIceServer(null);
  }

  // ── Periodic work ─────────────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.disposed || this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshId();
      const scope = this.opts.getRoomScope();
      const roster = this.opts.getRoomPeers?.() ?? null;
      if (scope && roster) this.registry.bindRoster(roster.pubs, scope.roomToken, this.now());
      this.prune();
      this.reassertGunPeers();
      // Offline groups need Android 10+ (app-chosen credentials); older phones use the LAN path only.
      const caps = this.opts.native.capabilities();
      const readiness = this.readRawReadiness();
      const env = { nativeBridge: true, readiness, permissionDenied: this.permissionDenied };
      const wifiDirectUsable = discoveryProviderAvailability('wifi-direct', this.wifiDirectAllowed, env) !== 'unsupported'
        && this.wifiDirectAllowed && !this.permissionDenied && caps.wifiDirect && caps.joinByCredential;
      const state = this.opts.native.getState();
      const inGroup = state.state === 'owner' || state.state === 'client';
      const ourGroup = inGroup && state.networkName === this.currentCredentials()?.networkName;
      // A room group from an earlier room token or app process (the OS keeps a Wi-Fi Direct group
      // after the app is killed or its data cleared) is never ours: leave it, or it blocks hosting
      // and joining the current room's group forever. Other apps' groups are left alone.
      if (inGroup && !ourGroup && state.networkName?.startsWith(OFFLINE_GROUP_NAME_PREFIX)) {
        this.ownsGroup = false;
        this.opts.onEvent?.({ type: 'stale-group-left', networkName: state.networkName });
        this.opts.native.leaveGroup();
        return;
      }
      const offline = !(await this.opts.hubReachable().catch(() => false));
      if (this.disposed) return;
      this.hubOnline = !offline;
      this.peerLanPhones();
      const now = this.now();
      // Online, the beacon runs only with an already-granted permission: no OS prompt mid-exchange.
      const bleAvailable = discoveryProviderAvailability('bluetooth', this.blePresence, env);
      // The beacon is the Wi-Fi Direct rendezvous, so it needs a phone that can join by credential.
      const bleUsable = this.blePresence && bleAvailable !== 'unsupported' && !this.permissionDenied
        && caps.wifiDirect && caps.joinByCredential
        && (offline ? true : bleAvailable === 'on' && readiness?.permission === true);
      const lanIds = this.registry.lanIds(now);
      // Network-free: any eligible phone the LAN does not reach needs a link while we are offline;
      // while we reach the hub, only an OFFLINE phone does (so we can exchange Talks; online pairs
      // use the hub).
      const groupCandidates = this.registry.eligibleRecords(now)
        .filter((record) => record.id !== this.id && !lanIds.has(record.id) && record.joinByCredential
          && (offline || !record.online)).length;
      const decision = this.policy.decide({
        now,
        lan: this.lanAllowed,
        wifiDirect: wifiDirectUsable,
        bluetooth: bleUsable,
        hubForDiscovery: !offline,
        roomPeerCount: roster ? roster.count : null,
        radioPeers: this.registry.freshCount(now),
        groupCandidates,
        inGroup: ourGroup,
      });
      if (decision.stage !== this.lastDecision?.stage || decision.lanNsd !== this.lastDecision.lanNsd
        || decision.bleScan !== this.lastDecision.bleScan || decision.wifiDirectDiscovery !== this.lastDecision.wifiDirectDiscovery) {
        this.opts.onEvent?.({ type: 'stage', stage: decision.stage, lanNsd: decision.lanNsd, bleScan: decision.bleScan, wifiDirectDiscovery: decision.wifiDirectDiscovery });
      }
      this.lastDecision = decision;
      this.applyLan(decision.lanNsd);
      // Online with no offline phone left to exchange with: the hub path (and the hub-matchmade upgrade)
      // serve everyone; free the radio after a dwell.
      this.onlineSince = !offline && ourGroup && groupCandidates === 0 ? (this.onlineSince ?? now) : null;
      if (this.onlineSince !== null && now - this.onlineSince >= ONLINE_LEAVE_GROUP_MS) {
        this.onlineSince = null;
        this.ownsGroup = false;
        this.opts.native.leaveGroup();
        if (this.wifiDirectActive) this.stopWifiDirect('hub-reachable');
        this.applyBle(decision.bleAdvertise, decision.bleScan);
        return;
      }
      if (decision.wifiDirectDiscovery && !this.wifiDirectActive) await this.startWifiDirect();
      else if (!decision.wifiDirectDiscovery && this.wifiDirectActive && !inGroup) {
        this.stopWifiDirect(offline ? 'quiet-backoff' : 'hub-reachable');
      }
      if (this.disposed) return;
      this.applyBle(decision.bleAdvertise && !this.permissionDenied, decision.bleScan && !(inGroup && offline));
      if (!this.wifiDirectActive) return;
      this.advertise();
      if (inGroup) {
        if (state.state === 'owner' && this.ownsGroup && this.fallback(offline, state)) return;
        return this.maybeTearDown(state);
      }
      if (state.state === 'forming' || state.state === 'joining' || this.now() < this.busyUntil) return;
      this.plan(decision.groupFormation, offline);
    } finally {
      this.ticking = false;
    }
  }

  private isOnlineStage(): boolean {
    return this.lastDecision?.stage?.startsWith('online') === true;
  }

  /** LAN NSD (advertise + discover) on or off; restarted with every id rotation while on. */
  private applyLan(wanted: boolean): void {
    const scope = this.opts.getRoomScope();
    if (wanted && scope && this.id) {
      if (this.lanRunning) return;
      this.lanRunning = true;
      this.opts.bridge.startLanDiscovery(this.opts.port, this.id, scope.roomToken.slice(0, 8));
    } else if (this.lanRunning) {
      this.lanRunning = false;
      this.opts.bridge.stopLanDiscovery();
    }
  }

  /** The BLE beacon: advertise (cheap) and, inside scan windows, scan. */
  private applyBle(advertiseWanted: boolean, scan: boolean): void {
    const scope = this.opts.getRoomScope();
    if (!advertiseWanted || !scope || !this.id) {
      if (this.bleState) {
        this.bleState = '';
        this.opts.bridge.stopBlePresence();
      }
      return;
    }
    const caps = this.opts.native.capabilities();
    const state = this.opts.native.getState();
    const hosting = state.state === 'owner' && !!state.networkName && state.networkName === this.currentCredentials()?.networkName;
    const payload = encodeBlePresence({
      id: this.id, canHost: caps.wifiDirect, joinByCredential: caps.joinByCredential, hostScore: caps.hostScore,
      roomToken: scope.roomToken, hosting, online: this.isOnlineStage(),
    });
    const next = `${payload}|${scan}`;
    if (next === this.bleState) return;
    this.bleState = next;
    this.opts.bridge.startBlePresence(payload, scan);
  }

  private plan(mayForm: boolean, offline: boolean): void {
    const caps = this.opts.native.capabilities();
    const now = this.now();
    // Only proof-verified or roster-bound phones: a short room prefix can collide or be replayed.
    const plan = planOfflineGroup({
      self: { id: this.id, canHost: caps.wifiDirect, joinByCredential: caps.joinByCredential, hostScore: caps.hostScore },
      // Every eligible phone takes part in the election (online ones too) so all sides agree on
      // one host; whether to act at all is the policy's `groupFormation`.
      records: this.registry.eligibleRecords(now),
      lanIds: this.registry.lanIds(now),
      now,
    });
    if (plan.action !== this.lastPlan?.action || (plan.action === 'join' && this.lastPlan?.action === 'join' && plan.record.id !== this.lastPlan.record.id)) {
      this.opts.onEvent?.({ type: 'plan', plan });
    }
    this.lastPlan = plan;
    if (!mayForm) return;
    if (plan.action === 'none' && plan.reason === 'no-offline-peers') {
      this.fallback(offline, this.opts.native.getState());
      return;
    }
    if (plan.action === 'host') {
      const credentials = this.currentCredentials();
      if (!credentials) return;
      this.ownsGroup = true;
      this.busyUntil = this.now() + CREATE_WAIT_MS;
      this.opts.native.createGroup(credentials);
    } else if (plan.action === 'join') {
      this.ownsGroup = true;
      this.joinedRecord = plan.record;
      this.busyUntil = this.now() + JOIN_WAIT_MS;
      this.opts.native.joinGroup(joinableCredentials(plan.record.group));
    }
  }

  /** Wi-Fi-only path when neither BLE nor DNS-SD has reported anyone. Returns true if it acted. */
  private fallback(offline: boolean, state: WifiDirectNativeState): boolean {
    // Plain P2P peer sightings carry no authenticated room capability. Joining an arbitrary
    // nearby group would cross the hard room boundary, so room-scoped mode deliberately waits
    // for BLE/DNS-SD carrying the opaque token instead.
    if (this.opts.getRoomScope()) return false;
    if (!offline || this.registry.lanIds(this.now()).size > 0) return false;
    const now = this.now();
    const plan = planWifiOnlyFallback({
      state: state.state === 'owner' ? 'owner' : 'idle',
      clientCount: state.clientCount ?? 0,
      peers: [...this.wdPeers.values()],
      cooldownUntil: this.ownerCooldown,
      phonesSince: this.phonesSince,
      emptySince: this.emptySince,
      hostDelayMs: this.hostDelayMs,
      leaveDelayMs: this.leaveDelayMs,
      now,
    });
    if (plan.action !== this.lastFallback) this.opts.onEvent?.({ type: 'fallback', plan });
    this.lastFallback = plan.action;
    switch (plan.action) {
      case 'none':
        return false;
      case 'join': {
        const joinCredentials = this.currentCredentials();
        if (!joinCredentials) return false;
        this.ownsGroup = true;
        this.fallbackJoinAddress = plan.address;
        this.busyUntil = now + JOIN_WAIT_MS;
        this.opts.native.joinGroup(joinCredentials);
        return true;
      }
      case 'host': {
        const hostCredentials = this.currentCredentials();
        if (!hostCredentials) return false;
        this.ownsGroup = true;
        this.busyUntil = now + CREATE_WAIT_MS;
        this.opts.native.createGroup(hostCredentials);
        return true;
      }
      case 'leave-and-join':
        // Our empty group loses to the other owner; the next idle tick joins it.
        this.emptySince = null;
        this.ownsGroup = false;
        this.busyUntil = now + 3_000;
        this.opts.native.leaveGroup();
        return true;
    }
  }

  private maybeTearDown(state: WifiDirectNativeState): void {
    if (!this.ownsGroup || state.state !== 'owner') { this.emptySince = null; return; }
    if ((state.clientCount ?? 0) > 0) { this.emptySince = null; return; }
    this.emptySince ??= this.now();
    if (this.now() - this.emptySince < EMPTY_GROUP_TEARDOWN_MS) return;
    this.emptySince = null;
    this.ownsGroup = false;
    this.opts.native.leaveGroup();
  }

  // ── Wi-Fi Direct discovery ────────────────────────────────────────────────────────────────

  private async startWifiDirect(): Promise<void> {
    const readiness = this.readReadiness();
    if (!readiness.permission) {
      const granted = await this.opts.requestPermission().catch(() => false);
      if (this.disposed) return;
      if (!granted) {
        // Ask once per app session; the toast leads to the app's settings from then on.
        this.permissionDenied = true;
        this.reportGap('permission');
        this.opts.onEvent?.({ type: 'wifi-direct', active: false, reason: 'permission-denied' });
        return;
      }
    }
    if (!readiness.wifiEnabled) this.reportGap('wifi');
    if (!readiness.locationEnabled) this.reportGap('location');
    if (!readiness.bluetoothEnabled) this.reportGap('bluetooth');
    this.wifiDirectActive = true;
    const random = this.opts.random ?? Math.random;
    this.hostDelayMs = 15_000 + Math.round(random() * 30_000);
    this.leaveDelayMs = 10_000 + Math.round(random() * 20_000);
    this.lastAdvertised = '';
    this.advertise();
    this.opts.bridge.startWifiDirectServiceDiscovery();
    this.opts.onEvent?.({ type: 'wifi-direct', active: true });
  }

  private stopWifiDirect(reason: string): void {
    this.wifiDirectActive = false;
    this.lastAdvertised = '';
    this.registry.clearRadioRecords();
    this.opts.bridge.stopWifiDirectServiceDiscovery();
    this.opts.onEvent?.({ type: 'wifi-direct', active: false, reason });
  }

  private advertise(): void {
    if (!this.wifiDirectActive || !this.id) return;
    const scope = this.opts.getRoomScope();
    if (!scope) {
      this.stopWifiDirect('no-active-room');
      return;
    }
    const caps = this.opts.native.capabilities();
    const state = this.opts.native.getState();
    const group = state.state === 'owner' && state.networkName && state.passphrase
      ? { networkName: state.networkName, passphrase: state.passphrase, ...(state.frequencyMhz ? { frequencyMhz: state.frequencyMhz } : {}) }
      : null;
    const self = { id: this.id, canHost: caps.wifiDirect, joinByCredential: caps.joinByCredential, hostScore: caps.hostScore };
    const inGroup = state.state === 'owner' || state.state === 'client';
    const txt = JSON.stringify(encodeNearbyTxt({ ...self, port: this.opts.port, roomToken: scope.roomToken, group, online: this.isOnlineStage() }));
    const advertisementState = txt + (inGroup ? '|in-group' : '');
    if (this.bleState) this.applyBle(true, !inGroup && (this.lastDecision?.bleScan ?? true));
    if (advertisementState === this.lastAdvertised) return;
    this.lastAdvertised = advertisementState;
    this.opts.bridge.advertiseWifiDirectService(txt);
  }

  // ── Group state ───────────────────────────────────────────────────────────────────────────

  private async handleGroupState(state: WifiDirectNativeState): Promise<void> {
    if (this.disposed) return;
    const previous = this.lastGroupState;
    this.lastGroupState = state.state;
    // A repeated 'failed' (native re-sends state with every discovery error) must not keep pushing
    // the retry back — on hardware it parked a phone whose first join failed indefinitely.
    if (state.state === 'failed' && previous === 'failed') return;
    this.opts.onEvent?.({ type: 'group', state: state.state, ...(state.localIp ? { localIp: state.localIp } : {}), ...(state.ownerIp ? { ownerIp: state.ownerIp } : {}) });
    if ((state.state === 'owner' || state.state === 'client') && state.localIp) {
      this.busyUntil = 0;
      // Our own offline group, kept by Android across an app restart: manage it as ours again.
      if (state.networkName === this.currentCredentials()?.networkName) this.ownsGroup = true;
      if (this.relayAddress !== state.localIp) {
        try {
          const server = await this.opts.localRelay.start(state.localIp);
          if (this.disposed) return;
          this.relayAddress = state.localIp;
          this.opts.setLocalLinkIceServer(server);
        } catch {
          this.relayAddress = null;
          this.opts.setLocalLinkIceServer(null);
        }
      }
      if (state.state === 'client' && state.ownerIp) {
        const url = `http://${state.ownerIp}:${this.joinedRecord?.port ?? this.opts.port}/gun`;
        if (!this.peeredUrls.has(url)) {
          this.peeredUrls.add(url);
          this.opts.addGunPeer(url);
        }
      }
      // An owner advertises its credentials right away so waiting phones can join.
      this.advertise();
      return;
    }
    if (state.state === 'idle' || state.state === 'failed') {
      if (this.relayAddress) {
        this.relayAddress = null;
        this.opts.setLocalLinkIceServer(null);
      }
      this.ownsGroup = false;
      this.joinedRecord = null;
      this.emptySince = null;
      if (state.state === 'failed') {
        this.busyUntil = this.now() + GROUP_RETRY_MS;
        if (this.fallbackJoinAddress) this.ownerCooldown.set(this.fallbackJoinAddress, this.now() + FALLBACK_OWNER_COOLDOWN_MS);
      }
      this.fallbackJoinAddress = null;
      this.advertise();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────────────────

  /**
   * Gun drops a peer from its list when the socket closes (mesh.bye), and never reconnects it —
   * seen on hardware when the group owner's app restarted: the client's roster stayed empty for
   * minutes. Re-add every peer we still want each tick; `addGunPeer` is a no-op while the peer is
   * present and otherwise probes until the node answers. Group-owner URLs only while we are a client.
   */
  private reassertGunPeers(): void {
    const state = this.opts.native.getState();
    const ownerUrl = state.state === 'client' && state.ownerIp
      ? `http://${state.ownerIp}:${this.joinedRecord?.port ?? this.opts.port}/gun`
      : null;
    for (const url of this.peeredUrls) {
      if (url.includes('://192.168.49.') && url !== ownerUrl) continue;
      // LAN phones only while offline (see `peerLanPhones`); a link made offline lapses online.
      if (this.hubOnline !== false && this.lanUrls.has(url)) continue;
      this.opts.addGunPeer(url);
    }
    if (ownerUrl && !this.peeredUrls.has(ownerUrl)) {
      this.peeredUrls.add(ownerUrl);
      this.opts.addGunPeer(ownerUrl);
    }
  }

  private async refreshId(): Promise<void> {
    const scope = this.opts.getRoomScope();
    if (!scope) return;
    const next = await rotatingNearbyId(this.opts.localPub, this.now(), scope.roomToken);
    if (next === this.id || this.disposed) return;
    this.id = next;
    if (this.lanRunning) this.opts.bridge.startLanDiscovery(this.opts.port, this.id, scope.roomToken.slice(0, 8));
    this.advertise();
  }

  private prune(): void {
    const now = this.now();
    this.registry.prune(now);
    for (const [address, peer] of this.wdPeers) if (now - peer.seenAt > 60_000) this.wdPeers.delete(address);
    const phones = [...this.wdPeers.values()].some((peer) => now - peer.seenAt <= 30_000 && /^10-/.test(peer.type));
    this.phonesSince = phones ? (this.phonesSince ?? now) : null;
  }

  private readRawReadiness(): DiscoveryReadiness | null {
    try {
      return JSON.parse(this.opts.bridge.nearbyReadiness()) as DiscoveryReadiness;
    } catch {
      return null;
    }
  }

  private readReadiness(): NearbyReadiness {
    try {
      const value = JSON.parse(this.opts.bridge.nearbyReadiness()) as Partial<NearbyReadiness>;
      const raw = value as Partial<NearbyReadiness> & { bluetoothPermission?: boolean; ble?: boolean };
      return {
        permission: raw.permission === true && raw.bluetoothPermission !== false,
        wifiEnabled: raw.wifiEnabled !== false,
        locationEnabled: raw.locationEnabled !== false,
        bluetoothEnabled: raw.ble === false || raw.bluetoothEnabled !== false,
      };
    } catch {
      return { permission: false, wifiEnabled: true, locationEnabled: true, bluetoothEnabled: true };
    }
  }

  private reportGap(gap: NearbyReadinessGap): void {
    if (this.reportedGaps.has(gap)) return;
    this.reportedGaps.add(gap);
    this.opts.onReadinessGap?.(gap);
  }

  private currentCredentials() {
    const scope = this.opts.getRoomScope();
    return scope ? deriveOfflineGroupCredentials(scope) : null;
  }
}

/** Returns the bridge when the Android shell exposes offline discovery, else null. */
export function readNearbyOfflineBridge(win: unknown = typeof window !== 'undefined' ? window : undefined): NearbyOfflineBridge | null {
  const bridge = (win as { IinPublicNearby?: Partial<NearbyOfflineBridge> } | undefined)?.IinPublicNearby;
  if (!bridge || typeof bridge.startLanDiscovery !== 'function' || typeof bridge.nearbyReadiness !== 'function') return null;
  return bridge as NearbyOfflineBridge;
}
