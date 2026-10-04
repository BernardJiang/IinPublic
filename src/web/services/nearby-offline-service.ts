import {
  encodeBlePresence,
  encodeNearbyTxt,
  lanGunPeerUrl,
  NEARBY_LAN_TTL_MS,
  NEARBY_RECORD_TTL_MS,
  OFFLINE_GROUP_CREDENTIALS,
  parseBlePresence,
  parseNearbyTxt,
  planOfflineGroup,
  planWifiOnlyFallback,
  type WifiDirectPeerSighting,
  type WifiOnlyPlan,
  rotatingNearbyId,
  type NearbyRecord,
  type OfflineGroupPlan,
} from '../../shared/nearby-offline';
import { joinableCredentials } from '../../shared/wifi-direct-link';
import type { LocalLinkRelay, WifiDirectNative, WifiDirectNativeState } from './wifi-direct-link-service';

/** Offline-discovery methods on `window.IinPublicNearby` (NearbyJavascriptBridge.kt). */
export type NearbyOfflineBridge = {
  startLanDiscovery(port: number, nearbyId: string): void;
  stopLanDiscovery(): void;
  advertiseWifiDirectService(txtJson: string): void;
  startWifiDirectServiceDiscovery(): void;
  stopWifiDirectServiceDiscovery(): void;
  nearbyReadiness(): string;
  openNearbySettings(kind: string): void;
  startBlePresence(payloadHex: string): void;
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
  | { kind: 'wifi-direct'; hosting: boolean; phones: number | null; lanPhones: number };

export type NearbyReadinessGap = 'permission' | 'wifi' | 'location' | 'bluetooth';

export type NearbyOfflineEvent =
  | { type: 'lan-peer'; id: string; url: string }
  | { type: 'wd-record'; id: string; hosting: boolean; via: 'ble' | 'dns-sd' }
  | { type: 'plan'; plan: OfflineGroupPlan }
  | { type: 'fallback'; plan: WifiOnlyPlan }
  | { type: 'group'; state: WifiDirectNativeState['state']; localIp?: string; ownerIp?: string }
  | { type: 'wifi-direct'; active: boolean; reason?: string };

export type NearbyOfflineServiceOptions = {
  localPub: string;
  /** Port of this phone's embedded node; peers' ports come from their records. */
  port: number;
  bridge: NearbyOfflineBridge;
  native: WifiDirectNative;
  localRelay: LocalLinkRelay;
  addGunPeer: (url: string) => void;
  setLocalLinkIceServer: (server: RTCIceServer | null) => void;
  hubReachable: () => Promise<boolean>;
  /** Wi-Fi Direct + BLE permissions, asked in context the first time the phone is offline. */
  requestPermission: () => Promise<boolean>;
  /** False when the user explicitly turned Wi-Fi Direct off. */
  wifiDirectAllowed: boolean;
  /** Device testing only (`?nearby_lan=0`): skip NSD so one LAN can exercise Wi-Fi Direct. */
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
 * OPEN-36 offline mode (see `src/shared/nearby-offline.ts`). LAN discovery always runs and peers
 * the page's Gun with other phones' nodes. Wi-Fi Direct discovery runs only while the hub is
 * unreachable: a phone online keeps using the hub (and the hub-matchmade link upgrade), so it never
 * forms groups with strangers or spends battery scanning.
 */
export class NearbyOfflineService {
  private readonly now: () => number;
  private readonly events: EventTarget;
  private id = '';
  private readonly lanIds = new Map<string, number>();
  private readonly peeredUrls = new Set<string>();
  private readonly records = new Map<string, NearbyRecord>();
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
    const detail = (event as CustomEvent<{ source?: unknown; transportId?: unknown; endpoint?: unknown }>).detail;
    if (detail?.source !== 'mdns') return;
    const url = lanGunPeerUrl(detail.endpoint);
    const peerId = typeof detail.transportId === 'string' ? detail.transportId : '';
    // Never peer with ourselves (a resolve without TXT falls back to the service name).
    if (!url || !peerId || peerId === this.id || peerId.endsWith(`-${this.id}`)) return;
    this.lanIds.set(peerId, this.now());
    if (this.peeredUrls.has(url)) return;
    this.peeredUrls.add(url);
    this.opts.addGunPeer(url);
    this.opts.onEvent?.({ type: 'lan-peer', id: peerId, url });
  };

  private readonly serviceEvent = (event: Event): void => {
    const detail = (event as CustomEvent<{ txt?: unknown; deviceAddress?: unknown }>).detail;
    const record = parseNearbyTxt(detail?.txt, this.now(), typeof detail?.deviceAddress === 'string' ? detail.deviceAddress : undefined);
    if (!record || record.id === this.id) return;
    const previous = this.records.get(record.id);
    this.records.set(record.id, record);
    if (!previous || !!previous.group !== !!record.group) {
      this.opts.onEvent?.({ type: 'wd-record', id: record.id, hosting: !!record.group, via: 'dns-sd' });
    }
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
    const record = parseBlePresence(detail?.payload, this.now(), this.opts.port);
    if (!record || record.id === this.id) return;
    const previous = this.records.get(record.id);
    this.records.set(record.id, record);
    if (!previous || !!previous.group !== !!record.group) {
      this.opts.onEvent?.({ type: 'wd-record', id: record.id, hosting: !!record.group, via: 'ble' });
    }
  };

  constructor(private readonly opts: NearbyOfflineServiceOptions) {
    this.wifiDirectAllowed = opts.wifiDirectAllowed;
    this.blePresence = opts.blePresence !== false;
    this.now = opts.now ?? Date.now;
    this.events = opts.events ?? window;
  }

  async start(): Promise<void> {
    this.id = await rotatingNearbyId(this.opts.localPub, this.now());
    if (this.disposed) return;
    this.events.addEventListener('iinpublic-nearby-candidate', this.candidateEvent);
    this.events.addEventListener('iinpublic-nearby-wd-service', this.serviceEvent);
    this.events.addEventListener('iinpublic-nearby-ble', this.bleEvent);
    this.events.addEventListener('iinpublic-nearby-wd-peers', this.peersEvent);
    this.unsubscribeNative = this.opts.native.onState((state) => { void this.handleGroupState(state); });
    if (this.opts.lanDiscovery !== false) this.opts.bridge.startLanDiscovery(this.opts.port, this.id);
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
  updateSettings(settings: { wifiDirect: boolean; bluetooth: boolean }): void {
    const bleChanged = settings.bluetooth !== this.blePresence;
    this.blePresence = settings.bluetooth;
    this.wifiDirectAllowed = settings.wifiDirect;
    if (!settings.wifiDirect) {
      const state = this.opts.native.getState();
      if ((state.state === 'owner' || state.state === 'client') && state.networkName === OFFLINE_GROUP_CREDENTIALS.networkName) {
        this.ownsGroup = false;
        this.opts.native.leaveGroup();
      }
      if (this.wifiDirectActive) this.stopWifiDirect('disabled-in-settings');
      return;
    }
    if (bleChanged && this.wifiDirectActive) {
      if (!settings.bluetooth) this.opts.bridge.stopBlePresence();
      this.lastAdvertised = '';
      this.advertise();
    }
    void this.tick();
  }

  /** Plain-language state for the Settings screen. */
  getStatus(): NearbyStatus {
    const state = this.opts.native.getState();
    const lanPhones = this.peeredUrls.size === 0 ? 0 : [...this.peeredUrls].filter((url) => !url.includes('192.168.49.')).length;
    if ((state.state === 'owner' || state.state === 'client') && state.networkName === OFFLINE_GROUP_CREDENTIALS.networkName) {
      return {
        kind: 'wifi-direct',
        hosting: state.state === 'owner',
        // Only the host knows how many phones joined.
        phones: state.state === 'owner' ? state.clientCount ?? 0 : null,
        lanPhones,
      };
    }
    if (this.wifiDirectActive) return { kind: 'searching', lanPhones };
    if (!this.wifiDirectAllowed) return { kind: 'off', lanPhones };
    return { kind: 'standby', lanPhones };
  }

  getDiagnostics(): Record<string, unknown> {
    const now = this.now();
    return {
      id: this.id,
      lanPeers: [...this.lanIds.entries()].map(([id, at]) => ({ id, ageSeconds: Math.round((now - at) / 1000) })),
      gunPeers: [...this.peeredUrls],
      wifiDirectActive: this.wifiDirectActive,
      permissionDenied: this.permissionDenied,
      records: [...this.records.values()].map((record) => ({
        id: record.id,
        hosting: !!record.group,
        joinByCredential: record.joinByCredential,
        ageSeconds: Math.round((now - record.seenAt) / 1000),
      })),
      group: this.opts.native.getState(),
      relayAddress: this.relayAddress,
      lastPlan: this.lastPlan,
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
    if (this.wifiDirectActive) {
      this.opts.bridge.stopWifiDirectServiceDiscovery();
      this.opts.bridge.stopBlePresence();
    }
    if (this.ownsGroup) this.opts.native.leaveGroup();
    this.opts.setLocalLinkIceServer(null);
  }

  // ── Periodic work ─────────────────────────────────────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.disposed || this.ticking) return;
    this.ticking = true;
    try {
      await this.refreshId();
      this.prune();
      this.reassertGunPeers();
      // Offline groups need Android 10+ (app-chosen credentials); older phones use the LAN path only.
      const caps = this.opts.native.capabilities();
      if (!this.wifiDirectAllowed || this.permissionDenied || !caps.wifiDirect || !caps.joinByCredential) return;
      const state = this.opts.native.getState();
      const inGroup = state.state === 'owner' || state.state === 'client';
      const offline = !(await this.opts.hubReachable().catch(() => false));
      if (this.disposed) return;
      this.onlineSince = offline ? null : (this.onlineSince ?? this.now());
      if (!offline && inGroup && state.networkName === OFFLINE_GROUP_CREDENTIALS.networkName
        && this.now() - this.onlineSince! >= ONLINE_LEAVE_GROUP_MS) {
        // Online again: the hub path (and the hub-matchmade upgrade) take over; free the radio.
        this.onlineSince = null;
        this.ownsGroup = false;
        this.opts.native.leaveGroup();
        if (this.wifiDirectActive) this.stopWifiDirect('hub-reachable');
        return;
      }
      if (offline && !this.wifiDirectActive) await this.startWifiDirect();
      else if (!offline && this.wifiDirectActive && !inGroup) this.stopWifiDirect('hub-reachable');
      if (!this.wifiDirectActive) return;
      this.advertise();
      if (inGroup) {
        if (state.state === 'owner' && this.ownsGroup && this.fallback(offline, state)) return;
        return this.maybeTearDown(state);
      }
      if (state.state === 'forming' || state.state === 'joining' || this.now() < this.busyUntil) return;
      this.plan(offline);
    } finally {
      this.ticking = false;
    }
  }

  private plan(offline: boolean): void {
    const caps = this.opts.native.capabilities();
    const plan = planOfflineGroup({
      self: { id: this.id, canHost: caps.wifiDirect, joinByCredential: caps.joinByCredential, hostScore: caps.hostScore },
      records: [...this.records.values()],
      lanIds: new Set(this.lanIds.keys()),
      now: this.now(),
    });
    if (plan.action !== this.lastPlan?.action || (plan.action === 'join' && this.lastPlan?.action === 'join' && plan.record.id !== this.lastPlan.record.id)) {
      this.opts.onEvent?.({ type: 'plan', plan });
    }
    this.lastPlan = plan;
    if (!offline) return;
    if (plan.action === 'none' && plan.reason === 'no-offline-peers') {
      this.fallback(offline, this.opts.native.getState());
      return;
    }
    if (plan.action === 'host') {
      this.ownsGroup = true;
      this.busyUntil = this.now() + CREATE_WAIT_MS;
      this.opts.native.createGroup(OFFLINE_GROUP_CREDENTIALS);
    } else if (plan.action === 'join') {
      this.ownsGroup = true;
      this.joinedRecord = plan.record;
      this.busyUntil = this.now() + JOIN_WAIT_MS;
      this.opts.native.joinGroup(joinableCredentials(plan.record.group));
    }
  }

  /** Wi-Fi-only path when neither BLE nor DNS-SD has reported anyone. Returns true if it acted. */
  private fallback(offline: boolean, state: WifiDirectNativeState): boolean {
    if (!offline || this.lanIds.size > 0) return false;
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
      case 'join':
        this.ownsGroup = true;
        this.fallbackJoinAddress = plan.address;
        this.busyUntil = now + JOIN_WAIT_MS;
        this.opts.native.joinGroup(OFFLINE_GROUP_CREDENTIALS);
        return true;
      case 'host':
        this.ownsGroup = true;
        this.busyUntil = now + CREATE_WAIT_MS;
        this.opts.native.createGroup(OFFLINE_GROUP_CREDENTIALS);
        return true;
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
    this.records.clear();
    this.opts.bridge.stopWifiDirectServiceDiscovery();
    this.opts.bridge.stopBlePresence();
    this.opts.onEvent?.({ type: 'wifi-direct', active: false, reason });
  }

  private advertise(): void {
    if (!this.wifiDirectActive || !this.id) return;
    const caps = this.opts.native.capabilities();
    const state = this.opts.native.getState();
    const group = state.state === 'owner' && state.networkName && state.passphrase
      ? { networkName: state.networkName, passphrase: state.passphrase, ...(state.frequencyMhz ? { frequencyMhz: state.frequencyMhz } : {}) }
      : null;
    const self = { id: this.id, canHost: caps.wifiDirect, joinByCredential: caps.joinByCredential, hostScore: caps.hostScore };
    const txt = JSON.stringify(encodeNearbyTxt({ ...self, port: this.opts.port, group }));
    if (txt === this.lastAdvertised) return;
    this.lastAdvertised = txt;
    this.opts.bridge.advertiseWifiDirectService(txt);
    if (this.blePresence) this.opts.bridge.startBlePresence(encodeBlePresence({ ...self, hosting: !!group }));
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
      if (state.networkName === OFFLINE_GROUP_CREDENTIALS.networkName) this.ownsGroup = true;
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
      this.opts.addGunPeer(url);
    }
    if (ownerUrl && !this.peeredUrls.has(ownerUrl)) {
      this.peeredUrls.add(ownerUrl);
      this.opts.addGunPeer(ownerUrl);
    }
  }

  private async refreshId(): Promise<void> {
    const next = await rotatingNearbyId(this.opts.localPub, this.now());
    if (next === this.id || this.disposed) return;
    this.id = next;
    if (this.opts.lanDiscovery !== false) this.opts.bridge.startLanDiscovery(this.opts.port, this.id);
    this.advertise();
  }

  private prune(): void {
    const now = this.now();
    for (const [id, at] of this.lanIds) if (now - at > NEARBY_LAN_TTL_MS) this.lanIds.delete(id);
    for (const [id, record] of this.records) if (now - record.seenAt > NEARBY_RECORD_TTL_MS * 2) this.records.delete(id);
    for (const [address, peer] of this.wdPeers) if (now - peer.seenAt > 60_000) this.wdPeers.delete(address);
    const phones = [...this.wdPeers.values()].some((peer) => now - peer.seenAt <= 30_000 && /^10-/.test(peer.type));
    this.phonesSince = phones ? (this.phonesSince ?? now) : null;
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
}

/** Returns the bridge when the Android shell exposes offline discovery, else null. */
export function readNearbyOfflineBridge(win: unknown = typeof window !== 'undefined' ? window : undefined): NearbyOfflineBridge | null {
  const bridge = (win as { IinPublicNearby?: Partial<NearbyOfflineBridge> } | undefined)?.IinPublicNearby;
  if (!bridge || typeof bridge.startLanDiscovery !== 'function' || typeof bridge.nearbyReadiness !== 'function') return null;
  return bridge as NearbyOfflineBridge;
}
