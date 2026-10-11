import { portableSha256Hex } from './portable-sha256';
import { NEARBY_ID_EPOCH_MS, type NearbyRecord } from './nearby-offline';

/**
 * P1 discovery simplification (TODO OPEN-40, design `nearby-and-place-chatrooms.md`).
 *
 * Four providers, one audience. Every provider observes the same signed active-room capability;
 * provider range affects reachability, never room membership or the `C` limit.
 *
 * Network-free principle (product owner, 2026-10-11): every provider works with whatever network is
 * up, and any working network is used to reach as many room members as possible. Only the hub
 * uplink over cellular is a switch; LAN, Wi-Fi Direct and Bluetooth never depend on the hub.
 *
 * - `cellular`: reaching the hub over mobile data. Off: discovery never uses cellular data. The hub
 *   is still used over Wi-Fi/Ethernet; with no other uplink the phone relies on its radios.
 * - `lan`: Android NSD on the shared Wi-Fi.
 * - `wifi-direct`: room-scoped DNS-SD and demand-driven group formation, online or offline. An
 *   online phone links with an offline same-room phone so the two can exchange Talks; two online
 *   phones keep using the hub path instead. Relaying the offline phone onward to the hub
 *   (bridging) is deferred.
 * - `bluetooth`: BLE presence (proximity evidence only; Talks never travel over BLE).
 */
export type DiscoveryProviderKind = 'cellular' | 'lan' | 'wifi-direct' | 'bluetooth';
export const DISCOVERY_PROVIDER_KINDS: readonly DiscoveryProviderKind[] = ['cellular', 'lan', 'wifi-direct', 'bluetooth'];

export type DiscoveryProviderAvailability =
  | 'on'
  | 'off'
  /** The device or runtime cannot run this provider (browser, Android 7–9 Wi-Fi Direct, no BLE). */
  | 'unsupported'
  | 'permission-denied'
  /** The radio (Wi-Fi, Bluetooth, Location on Android ≤ 12) is switched off system-wide. */
  | 'radio-off';

/** Mirrors `NearbyConnectivityManager.nearbyReadiness()` (Android); absent fields mean unknown. */
export type DiscoveryReadiness = {
  permission?: boolean;
  bluetoothPermission?: boolean;
  wifiEnabled?: boolean;
  locationEnabled?: boolean;
  bluetoothEnabled?: boolean;
  wifiDirect?: boolean;
  joinByCredential?: boolean;
  ble?: boolean;
};

export type DiscoveryProviderEnvironment = {
  /** False in an ordinary browser: only the hub exists there and none of these switches apply. */
  nativeBridge: boolean;
  readiness: DiscoveryReadiness | null;
  /** The user denied the in-context Nearby prompt this session. */
  permissionDenied: boolean;
};

/** Whether one provider can run, given the user's switch and the device. */
export function discoveryProviderAvailability(
  kind: DiscoveryProviderKind,
  enabled: boolean,
  env: DiscoveryProviderEnvironment,
): DiscoveryProviderAvailability {
  if (!env.nativeBridge) return 'unsupported';
  const readiness = env.readiness ?? {};
  switch (kind) {
    case 'cellular':
      return enabled ? 'on' : 'off';
    case 'lan':
      if (!enabled) return 'off';
      return readiness.wifiEnabled === false ? 'radio-off' : 'on';
    case 'wifi-direct':
      if (readiness.wifiDirect === false || readiness.joinByCredential === false) return 'unsupported';
      if (!enabled) return 'off';
      if (env.permissionDenied) return 'permission-denied';
      if (readiness.wifiEnabled === false || readiness.locationEnabled === false) return 'radio-off';
      return 'on';
    case 'bluetooth':
      // The beacon is the Wi-Fi Direct rendezvous: Android 7–9 phones (no join-by-credential) sit out.
      if (readiness.ble === false || readiness.wifiDirect === false || readiness.joinByCredential === false) return 'unsupported';
      if (!enabled) return 'off';
      if (env.permissionDenied || readiness.bluetoothPermission === false) return 'permission-denied';
      if (readiness.bluetoothEnabled === false) return 'radio-off';
      return 'on';
  }
}

/** Android `networkPathState()` subset. */
export type DiscoveryNetworkPath = {
  connected?: boolean;
  validated?: boolean;
  metered?: boolean;
  transports?: readonly string[];
};

/**
 * The hub may be used for discovery over this path. Only a cellular-only path is affected by the
 * Cellular switch; an unknown path (older shells) keeps the reachable-hub behavior.
 */
export function hubDiscoveryPathAllowed(path: DiscoveryNetworkPath | null, cellularEnabled: boolean): boolean {
  if (!path) return true;
  if (path.connected === false || path.validated === false) return false;
  if (cellularEnabled) return true;
  const transports = (path.transports ?? []).map(String);
  const freeUplink = transports.includes('wifi') || transports.includes('ethernet');
  return freeUplink || !transports.includes('cellular');
}

// ── Staged policy ─────────────────────────────────────────────────────────────────────────────

/** One radio scan window. */
export const DISCOVERY_SCAN_WINDOW_MS = 30_000;
/** Quiet-singleton backoff after an empty window: base doubles per empty window up to the cap. */
export const DISCOVERY_OFFLINE_BACKOFF_BASE_MS = 30_000;
export const DISCOVERY_OFFLINE_BACKOFF_MAX_MS = 10 * 60_000;
/** Without a BLE beacon, DNS-SD windows are the only way two quiet phones meet: keep them close. */
export const DISCOVERY_OFFLINE_BACKOFF_MAX_NO_BLE_MS = 2 * 60_000;
export const DISCOVERY_ONLINE_BACKOFF_BASE_MS = 60_000;
export const DISCOVERY_ONLINE_BACKOFF_MAX_MS = 30 * 60_000;

export type DiscoveryStage =
  /** Hub available, nobody else in the room: LAN silent, BLE beacon + rare bounded scans. */
  | 'online-singleton'
  /** Hub available, room has peers: LAN NSD for the free IP fast path, BLE bounded. */
  | 'online-peers'
  /** No hub: a scan window is open. */
  | 'offline-searching'
  /** No hub, nobody found: beacon only until the next (backed-off) window. */
  | 'offline-quiet'
  /** No hub, a same-room phone is nearby or a group exists: scan continuously, form groups. */
  | 'offline-peers';

export type DiscoveryPolicyInput = {
  now: number;
  /** Availability after the switch, capability, permission and radio checks. */
  lan: boolean;
  wifiDirect: boolean;
  bluetooth: boolean;
  /** The hub is reachable over a path the policy permits (Cellular switch, metered policy). */
  hubForDiscovery: boolean;
  /** Other members of the active room in the verified roster; null = unknown. */
  roomPeerCount: number | null;
  /** Fresh same-room sightings from LAN/BLE/DNS-SD (provisional or verified). */
  radioPeers: number;
  /**
   * Eligible same-room phones the LAN does not reach that need a Wi-Fi Direct link: any such phone
   * while this one is offline; only OFFLINE such phones while this one reaches the hub.
   */
  groupCandidates: number;
  /** Currently in the room's offline Wi-Fi Direct group. */
  inGroup: boolean;
};

export type DiscoveryPolicyDecision = {
  stage: DiscoveryStage;
  lanNsd: boolean;
  /** Advertise the BLE beacon (cheap, continuous while the provider is on). */
  bleAdvertise: boolean;
  /** Actively scan BLE (duty-cycled while singleton). */
  bleScan: boolean;
  /** Wi-Fi Direct DNS-SD advertise + discovery. */
  wifiDirectDiscovery: boolean;
  /** May create or join the room's Wi-Fi Direct group (an eligible peer that needs it is required). */
  groupFormation: boolean;
  /** When the policy wants to be re-evaluated even if nothing else changes. */
  nextReviewAt: number;
};

/** Mutable planner state: duty-cycle window and quiet-singleton backoff. */
export class DiscoveryPolicy {
  private trigger = '';
  private emptyWindows = 0;
  private windowEndsAt: number | null = null;
  private nextWindowAt = 0;

  /** Forget backoff (room change, explicit retry, Settings change). */
  reset(): void {
    this.trigger = '';
    this.emptyWindows = 0;
    this.windowEndsAt = null;
    this.nextWindowAt = 0;
  }

  getBackoffState(): { emptyWindows: number; windowEndsAt: number | null; nextWindowAt: number } {
    return { emptyWindows: this.emptyWindows, windowEndsAt: this.windowEndsAt, nextWindowAt: this.nextWindowAt };
  }

  decide(input: DiscoveryPolicyInput): DiscoveryPolicyDecision {
    const { now } = input;
    const roomHasPeers = input.roomPeerCount === null || input.roomPeerCount > 0;
    const nearbyPeers = input.radioPeers > 0 || input.inGroup;
    // Any change in what the phone knows restarts the backoff with an immediate window.
    const trigger = `${input.hubForDiscovery}|${roomHasPeers}|${nearbyPeers}|${input.bluetooth}|${input.wifiDirect}`;
    if (trigger !== this.trigger) {
      this.trigger = trigger;
      this.emptyWindows = 0;
      this.windowEndsAt = null;
      this.nextWindowAt = now;
    }
    let scanning: boolean;
    if (nearbyPeers) {
      // Somebody is here: keep looking; the window/backoff resumes once they are gone.
      scanning = true;
      this.windowEndsAt = null;
      this.nextWindowAt = now;
    } else {
      if (this.windowEndsAt !== null && now >= this.windowEndsAt) {
        this.emptyWindows += 1;
        this.windowEndsAt = null;
        this.nextWindowAt = now + this.backoffMs(input);
      }
      if (this.windowEndsAt === null && now >= this.nextWindowAt) this.windowEndsAt = now + DISCOVERY_SCAN_WINDOW_MS;
      scanning = this.windowEndsAt !== null;
    }
    const offline = !input.hubForDiscovery;
    const stage: DiscoveryStage = offline
      ? (nearbyPeers ? 'offline-peers' : scanning ? 'offline-searching' : 'offline-quiet')
      : (roomHasPeers || nearbyPeers ? 'online-peers' : 'online-singleton');
    const nextReviewAt = nearbyPeers
      ? now + DISCOVERY_SCAN_WINDOW_MS
      : (this.windowEndsAt ?? this.nextWindowAt);
    return {
      stage,
      // The free IP path: only worth multicast wake-ups when there is somebody to find.
      lanNsd: input.lan && (offline || roomHasPeers || input.radioPeers > 0),
      bleAdvertise: input.bluetooth,
      // An offline group member stops scanning (battery); an online bridge keeps bounded scans so it
      // notices when the offline phones it serves are gone.
      bleScan: input.bluetooth && scanning && !(input.inGroup && offline),
      // Offline: Wi-Fi Direct DNS-SD runs in scan windows. Online it stays idle (it takes the radio
      // off the Wi-Fi channel) until an offline same-room phone needs it.
      wifiDirectDiscovery: input.wifiDirect && (input.inGroup || input.groupCandidates > 0 || (offline && scanning)),
      groupFormation: input.wifiDirect && input.groupCandidates > 0,
      nextReviewAt,
    };
  }

  private backoffMs(input: DiscoveryPolicyInput): number {
    const offline = !input.hubForDiscovery;
    const base = offline ? DISCOVERY_OFFLINE_BACKOFF_BASE_MS : DISCOVERY_ONLINE_BACKOFF_BASE_MS;
    const max = offline
      ? (input.bluetooth ? DISCOVERY_OFFLINE_BACKOFF_MAX_MS : DISCOVERY_OFFLINE_BACKOFF_MAX_NO_BLE_MS)
      : DISCOVERY_ONLINE_BACKOFF_MAX_MS;
    return Math.min(max, base * 2 ** Math.min(this.emptyWindows - 1, 16));
  }
}

// ── Provider-neutral candidate registry ───────────────────────────────────────────────────────

export type NearbySightingSource = 'lan' | 'ble' | 'dns-sd';

export type NearbySighting = {
  source: NearbySightingSource;
  /** Rotating scoped discovery id (12 hex). */
  discoveryId: string;
  seenAt: number;
  /** Full-token proof verified for this id. */
  roomVerified: boolean;
  /** LAN Gun URL or Wi-Fi Direct device address. Diagnostics/route selection only. */
  route?: string;
  /** Latest Wi-Fi Direct/BLE record (host election input). */
  record?: NearbyRecord;
};

export type NearbyLogicalPeer = {
  key: string;
  /** Canonical identity once a rotating id matched a signed roster member. */
  seaPub?: string;
  discoveryIds: string[];
  sources: NearbySightingSource[];
  routes: Array<{ source: NearbySightingSource; value: string; seenAt: number }>;
  /** Proof-verified or roster-bound: eligible for Wi-Fi Direct group formation. */
  eligible: boolean;
  /** Reachable over the shared LAN: never needs a group. */
  onLan: boolean;
  lastSeenAt: number;
  record?: NearbyRecord;
};

type PeerEntry = {
  key: string;
  seaPub?: string;
  ids: Map<string, number>;
  sources: Map<NearbySightingSource, number>;
  routes: Map<string, { source: NearbySightingSource; value: string; seenAt: number }>;
  verifiedAt: number | null;
  lanAt: number | null;
  lastSeenAt: number;
  record?: NearbyRecord;
};

export const NEARBY_REGISTRY_MAX_PEERS = 498;
const ROUTES_PER_PEER = 8;
const IDS_PER_PEER = 4;

/**
 * Merges Internet-roster, LAN, BLE and Wi-Fi Direct sightings into one logical peer. Keyed first by
 * the scoped rotating id; re-keyed canonically by SEA identity once that id matches
 * `rotatingNearbyId(pub, room, epoch)` for a member of the signed active-room roster. Bounded by
 * the room capacity, so a crowd of radio sightings can never grow it past `C`.
 */
export class NearbyCandidateRegistry {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly keyById = new Map<string, string>();
  /** discovery id → roster pub, for the current and previous id epochs. */
  private rosterIds = new Map<string, string>();
  private rosterSignature = '';

  constructor(private readonly options: { ttlMs: number; lanTtlMs: number; maxPeers?: number }) {}

  /** Bind rotating ids to SEA identities from the active room's signed roster (bounded by `C`). */
  bindRoster(pubs: readonly string[], roomToken: string, now: number): void {
    const epoch = Math.floor(now / NEARBY_ID_EPOCH_MS);
    const unique = [...new Set(pubs.filter(Boolean))].slice(0, this.options.maxPeers ?? NEARBY_REGISTRY_MAX_PEERS);
    const signature = `${roomToken}|${epoch}|${unique.join(',')}`;
    if (signature === this.rosterSignature) return;
    this.rosterSignature = signature;
    const next = new Map<string, string>();
    for (const pub of unique) {
      for (const e of [epoch, epoch - 1]) {
        // Same digest as `rotatingNearbyId`, synchronously.
        next.set(portableSha256Hex(`iinpublic-nearby:${pub}:${roomToken}:${e}`).slice(0, 12), pub);
      }
    }
    this.rosterIds = next;
    for (const id of [...this.keyById.keys()]) this.rebind(id);
  }

  observe(sighting: NearbySighting): NearbyLogicalPeer {
    const id = sighting.discoveryId;
    const key = this.keyById.get(id) ?? this.canonicalKey(id);
    let entry = this.peers.get(key);
    if (!entry) {
      entry = { key, ids: new Map(), sources: new Map(), routes: new Map(), verifiedAt: null, lanAt: null, lastSeenAt: sighting.seenAt };
      const pub = this.rosterIds.get(id);
      if (pub) entry.seaPub = pub;
      this.peers.set(key, entry);
    }
    this.keyById.set(id, key);
    entry.ids.set(id, sighting.seenAt);
    entry.sources.set(sighting.source, sighting.seenAt);
    if (sighting.route) {
      entry.routes.set(`${sighting.source}:${sighting.route}`, { source: sighting.source, value: sighting.route, seenAt: sighting.seenAt });
    }
    if (sighting.roomVerified) entry.verifiedAt = sighting.seenAt;
    if (sighting.source === 'lan') entry.lanAt = sighting.seenAt;
    if (sighting.record) entry.record = sighting.record;
    entry.lastSeenAt = Math.max(entry.lastSeenAt, sighting.seenAt);
    this.trimEntry(entry);
    // LRU order: most recently observed last.
    this.peers.delete(key);
    this.peers.set(key, entry);
    this.enforceBound();
    return this.view(entry, sighting.seenAt);
  }

  prune(now: number): void {
    for (const [key, entry] of this.peers) {
      if (entry.lanAt !== null && now - entry.lanAt > this.options.lanTtlMs) entry.lanAt = null;
      const lastRadio = Math.max(-Infinity, ...[...entry.sources.entries()].filter(([s]) => s !== 'lan').map(([, at]) => at));
      const alive = entry.lanAt !== null || now - lastRadio <= this.options.ttlMs;
      if (!alive) {
        this.peers.delete(key);
        for (const id of entry.ids.keys()) this.keyById.delete(id);
      }
    }
  }

  /** Remove every radio record (Wi-Fi Direct stopped); LAN sightings stay. */
  clearRadioRecords(): void {
    for (const entry of this.peers.values()) {
      delete entry.record;
      entry.sources.delete('ble');
      entry.sources.delete('dns-sd');
    }
  }

  list(now: number): NearbyLogicalPeer[] {
    return [...this.peers.values()].map((entry) => this.view(entry, now));
  }

  /** Discovery ids that are reachable over the LAN, across every id the same logical peer used. */
  lanIds(now: number): Set<string> {
    const ids = new Set<string>();
    for (const peer of this.list(now)) if (peer.onLan) for (const id of peer.discoveryIds) ids.add(id);
    return ids;
  }

  /** Fresh records of eligible peers, one per logical peer, with its newest id. */
  eligibleRecords(now: number): NearbyRecord[] {
    return this.list(now)
      .filter((peer) => peer.eligible && peer.record && now - peer.record.seenAt <= this.options.ttlMs)
      .map((peer) => peer.record!);
  }

  /** Fresh same-room sightings (LAN, BLE, DNS-SD), deduplicated per logical peer. */
  freshCount(now: number): number {
    return this.list(now).filter((peer) => peer.onLan || now - peer.lastSeenAt <= this.options.ttlMs).length;
  }

  private canonicalKey(id: string): string {
    const pub = this.rosterIds.get(id);
    return pub ? `sea:${pub}` : `id:${id}`;
  }

  /** A roster update can turn an id-keyed entry into an SEA-keyed one, merging duplicates. */
  private rebind(id: string): void {
    const currentKey = this.keyById.get(id);
    const pub = this.rosterIds.get(id);
    if (!currentKey || !pub || currentKey === `sea:${pub}`) return;
    const from = this.peers.get(currentKey);
    if (!from) return;
    const targetKey = `sea:${pub}`;
    const target = this.peers.get(targetKey);
    this.peers.delete(currentKey);
    if (!target) {
      from.key = targetKey;
      from.seaPub = pub;
      this.peers.set(targetKey, from);
      for (const known of from.ids.keys()) this.keyById.set(known, targetKey);
      return;
    }
    for (const [known, at] of from.ids) { target.ids.set(known, Math.max(at, target.ids.get(known) ?? 0)); this.keyById.set(known, targetKey); }
    for (const [source, at] of from.sources) target.sources.set(source, Math.max(at, target.sources.get(source) ?? 0));
    for (const [routeKey, route] of from.routes) target.routes.set(routeKey, route);
    target.verifiedAt = Math.max(target.verifiedAt ?? -Infinity, from.verifiedAt ?? -Infinity);
    if (!Number.isFinite(target.verifiedAt)) target.verifiedAt = null;
    target.lanAt = Math.max(target.lanAt ?? -Infinity, from.lanAt ?? -Infinity);
    if (!Number.isFinite(target.lanAt)) target.lanAt = null;
    if (from.record && (!target.record || from.record.seenAt >= target.record.seenAt)) target.record = from.record;
    target.lastSeenAt = Math.max(target.lastSeenAt, from.lastSeenAt);
    this.trimEntry(target);
  }

  private trimEntry(entry: PeerEntry): void {
    while (entry.ids.size > IDS_PER_PEER) {
      const oldest = [...entry.ids.entries()].sort((a, b) => a[1] - b[1])[0]![0];
      entry.ids.delete(oldest);
      if (this.keyById.get(oldest) === entry.key) this.keyById.delete(oldest);
    }
    while (entry.routes.size > ROUTES_PER_PEER) {
      const oldest = [...entry.routes.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt)[0]![0];
      entry.routes.delete(oldest);
    }
  }

  private enforceBound(): void {
    const max = this.options.maxPeers ?? NEARBY_REGISTRY_MAX_PEERS;
    while (this.peers.size > max) {
      const [oldestKey, oldest] = this.peers.entries().next().value as [string, PeerEntry];
      this.peers.delete(oldestKey);
      for (const id of oldest.ids.keys()) if (this.keyById.get(id) === oldestKey) this.keyById.delete(id);
    }
  }

  private view(entry: PeerEntry, now: number): NearbyLogicalPeer {
    const newestId = [...entry.ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return {
      key: entry.key,
      ...(entry.seaPub ? { seaPub: entry.seaPub } : {}),
      discoveryIds: newestId,
      sources: [...entry.sources.keys()],
      routes: [...entry.routes.values()],
      eligible: !!entry.seaPub || entry.verifiedAt !== null,
      onLan: entry.lanAt !== null && now - entry.lanAt <= this.options.lanTtlMs,
      lastSeenAt: entry.lastSeenAt,
      ...(entry.record ? { record: entry.record } : {}),
    };
  }
}
