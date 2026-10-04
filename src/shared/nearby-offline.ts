import { sha256Hex, type WifiDirectGroupCredentials } from './wifi-direct-link';

/**
 * OPEN-36 offline mode: two Android phones find each other without the hub.
 *
 * - Same LAN: Android NSD (mDNS) finds the other phone's embedded node, and the page's Gun peers
 *   with it (`ws://<lan-ip>:<port>/gun`). Rosters, signaling and the WebRTC mesh then work as they
 *   do through the hub; host ICE candidates carry talks across the LAN.
 * - Different networks: Wi-Fi Direct DNS-SD service discovery. Every phone advertises a small TXT
 *   record; one phone hosts a group (deterministic election below) and advertises its credentials;
 *   Android 10+ phones join by name + passphrase without a prompt. Gun peers with the group owner's
 *   node (`ws://192.168.49.1:<port>/gun`) and WebRTC uses each phone's loopback TURN relay on the
 *   group address (`local-link-turn-relay.ts`).
 *
 * Presence travels over BLE (8-byte service data, below). Wi-Fi Direct DNS-SD stays as a second
 * channel but proved unreliable on hardware: queries time out while the peer is off channel
 * serving its access point.
 *
 * Every offline group uses the same app-wide credentials (`OFFLINE_GROUP_CREDENTIALS`), so a joiner
 * needs nothing from the host but its presence. That is TODO OPEN-36 option (a) — credentials in the
 * clear — taken one step further: anyone running the app nearby can join the Wi-Fi link. All
 * protection is above it — Gun/SEA validate data, mesh frames are SEA-signed, and the WebRTC
 * DataChannel is DTLS end to end (the owner forwards ciphertext).
 */

/** Android requires the `DIRECT-xy` prefix; 8–63 printable characters for the passphrase. */
export const OFFLINE_GROUP_CREDENTIALS: WifiDirectGroupCredentials = {
  networkName: 'DIRECT-iP-IinPublic-nearby',
  passphrase: 'iinpublic-nearby-v1-open-link',
};

export const BLE_PRESENCE_VERSION = 1;

export const NEARBY_TXT_VERSION = '1';
/** Rotating id lifetime: passive scanners cannot follow a phone across epochs. */
export const NEARBY_ID_EPOCH_MS = 15 * 60_000;
/** A Wi-Fi Direct record this old is ignored (peers re-advertise on every discovery round). */
export const NEARBY_RECORD_TTL_MS = 45_000;
/** A LAN sighting this old no longer suppresses Wi-Fi Direct for that phone. NSD reports a service
 *  once; discovery restarts on every id rotation, which refreshes sightings within one epoch. */
export const NEARBY_LAN_TTL_MS = NEARBY_ID_EPOCH_MS + 5 * 60_000;

export type NearbyRecord = {
  /** Rotating id (12 hex). The same id is advertised over NSD and Wi-Fi Direct. */
  id: string;
  port: number;
  /** Android 10+: joins a group by name + passphrase without the pairing prompt. */
  joinByCredential: boolean;
  /** 0–3: charging +2, battery ≥ 50 % +1. */
  hostScore: number;
  /** Present only while this phone owns a group. */
  group?: WifiDirectGroupCredentials;
  /** Wi-Fi Direct device address the record came from (diagnostics only). */
  deviceAddress?: string;
  seenAt: number;
};

export type NearbySelf = {
  id: string;
  canHost: boolean;
  joinByCredential: boolean;
  hostScore: number;
};

export type OfflineGroupPlan =
  | { action: 'none'; reason: string }
  | { action: 'wait'; reason: string }
  | { action: 'host' }
  | { action: 'join'; record: NearbyRecord & { group: WifiDirectGroupCredentials } };

export async function rotatingNearbyId(seaPub: string, nowMs: number = Date.now()): Promise<string> {
  const epoch = Math.floor(nowMs / NEARBY_ID_EPOCH_MS);
  return (await sha256Hex(`iinpublic-nearby:${seaPub}:${epoch}`)).slice(0, 12);
}

const ID_PATTERN = /^[0-9a-f]{12}$/;
const NETWORK_NAME_PATTERN = /^DIRECT-[A-Za-z0-9]{2}[ -~]{0,23}$/;
const PASSPHRASE_PATTERN = /^[ -~]{8,63}$/;

/** TXT keys stay short: Wi-Fi Direct service responses are small. */
export function encodeNearbyTxt(self: NearbySelf & { port: number; group?: WifiDirectGroupCredentials | null }): Record<string, string> {
  const txt: Record<string, string> = {
    v: NEARBY_TXT_VERSION,
    id: self.id,
    p: String(self.port),
    j: self.joinByCredential ? '1' : '0',
    s: String(Math.max(0, Math.min(3, Math.round(self.hostScore)))),
  };
  if (self.group) {
    txt.n = self.group.networkName;
    txt.k = self.group.passphrase;
    if (self.group.frequencyMhz) txt.f = String(self.group.frequencyMhz);
  }
  return txt;
}

export function parseNearbyTxt(txt: unknown, seenAt: number, deviceAddress?: string): NearbyRecord | null {
  if (!txt || typeof txt !== 'object') return null;
  const t = txt as Record<string, unknown>;
  const text = (key: string): string => (typeof t[key] === 'string' ? (t[key] as string) : '');
  if (text('v') !== NEARBY_TXT_VERSION) return null;
  const id = text('id');
  const port = Number(text('p'));
  if (!ID_PATTERN.test(id) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const record: NearbyRecord = {
    id,
    port,
    joinByCredential: text('j') === '1',
    hostScore: Math.max(0, Math.min(3, Number(text('s')) || 0)),
    seenAt,
    ...(deviceAddress ? { deviceAddress } : {}),
  };
  const networkName = text('n');
  const passphrase = text('k');
  if (NETWORK_NAME_PATTERN.test(networkName) && PASSPHRASE_PATTERN.test(passphrase)) {
    const frequencyMhz = Number(text('f'));
    record.group = {
      networkName,
      passphrase,
      ...(Number.isInteger(frequencyMhz) && frequencyMhz > 0 && frequencyMhz <= 7125 ? { frequencyMhz } : {}),
    };
  }
  return record;
}

/** RFC 1918 / link-local IPv4 — the only addresses a LAN Gun peer may use. */
export function isPrivateIpv4(address: string): boolean {
  const octets = String(address || '').split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = octets.map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/** `http://<private-ipv4>:<port>/gun` from an NSD endpoint, or null for anything else. */
export function lanGunPeerUrl(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string') return null;
  const match = /^http:\/\/([0-9.]+):(\d{1,5})\/gun$/.exec(endpoint.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (!isPrivateIpv4(match[1]!) || port < 1 || port > 65535) return null;
  return `http://${match[1]}:${port}/gun`;
}

/** Host preference: a phone that cannot join by credential (Android 7–9) must host; then the
 *  higher host score; then the lowest id. Every phone computes the same order. */
function hostRank(a: Pick<NearbySelf, 'id' | 'joinByCredential' | 'hostScore'>, b: Pick<NearbySelf, 'id' | 'joinByCredential' | 'hostScore'>): number {
  if (a.joinByCredential !== b.joinByCredential) return a.joinByCredential ? 1 : -1;
  if (a.hostScore !== b.hostScore) return b.hostScore - a.hostScore;
  return a.id.localeCompare(b.id);
}

/**
 * What this phone should do about a Wi-Fi Direct group, given the records it currently sees.
 * Phones already reachable over the LAN never need a group. The caller skips planning while the
 * phone is forming, joining or already in a group.
 */
export function planOfflineGroup(input: {
  self: NearbySelf;
  records: readonly NearbyRecord[];
  lanIds: ReadonlySet<string>;
  now: number;
}): OfflineGroupPlan {
  const { self, now } = input;
  const nearby = input.records.filter((record) =>
    record.id !== self.id && now - record.seenAt <= NEARBY_RECORD_TTL_MS && !input.lanIds.has(record.id));
  if (nearby.length === 0) return { action: 'none', reason: 'no-offline-peers' };

  const hosts = nearby
    .filter((record): record is NearbyRecord & { group: WifiDirectGroupCredentials } => !!record.group)
    .sort(hostRank);
  if (hosts.length > 0) {
    // Android 7–9 can only join with the owner's real device address and a prompt on the owner;
    // it stays on its normal path rather than joining.
    if (!self.joinByCredential) return { action: 'none', reason: 'cannot-join-by-credential' };
    return { action: 'join', record: hosts[0]! };
  }

  if (!self.canHost) return { action: 'wait', reason: 'cannot-host' };
  // Only phones that could actually join this one compete for host: two Android 7–9 phones cannot
  // link without a prompt, so they are ignored here and each may host for Android 10+ phones.
  const contenders = nearby.filter((record) => record.joinByCredential || self.joinByCredential);
  if (contenders.length === 0) return { action: 'none', reason: 'no-joinable-peers' };
  const winner = [self, ...contenders].sort(hostRank)[0]!;
  return winner.id === self.id ? { action: 'host' } : { action: 'wait', reason: 'peer-hosts' };
}

/**
 * BLE presence payload (hex): version, 6-byte rotating id, flags — bit 0 hosting the offline group,
 * bit 1 joins by credential, bits 2–3 host score.
 */
export function encodeBlePresence(self: NearbySelf & { hosting: boolean }): string {
  const flags = (self.hosting ? 1 : 0) | (self.joinByCredential ? 2 : 0) | ((Math.max(0, Math.min(3, Math.round(self.hostScore))) & 3) << 2);
  return `${BLE_PRESENCE_VERSION.toString(16).padStart(2, '0')}${self.id}${flags.toString(16).padStart(2, '0')}`;
}

export function parseBlePresence(payloadHex: unknown, seenAt: number, port: number): NearbyRecord | null {
  if (typeof payloadHex !== 'string' || !/^[0-9a-f]{16}$/.test(payloadHex)) return null;
  if (parseInt(payloadHex.slice(0, 2), 16) !== BLE_PRESENCE_VERSION) return null;
  const id = payloadHex.slice(2, 14);
  const flags = parseInt(payloadHex.slice(14, 16), 16);
  return {
    id,
    port,
    joinByCredential: (flags & 2) !== 0,
    hostScore: (flags >> 2) & 3,
    seenAt,
    ...((flags & 1) !== 0 ? { group: OFFLINE_GROUP_CREDENTIALS } : {}),
  };
}

// ── Wi-Fi-only fallback (no BLE, no DNS-SD) ──────────────────────────────────────────────────
// Plain P2P peer discovery is reliable even when DNS-SD frames keep missing (phones time-slicing
// their radio with an access point). With app-wide group credentials a phone can simply try to join
// any phone-type group owner it sees — the join only succeeds for an IinPublic group — and, when it
// sees phones but no owner, host after a random delay. An owner nobody joined that sees another
// owner leaves and joins it, so two simultaneous hosts converge.

export type WifiDirectPeerSighting = { address: string; groupOwner: boolean; type: string; seenAt: number };

export type WifiOnlyPlan =
  | { action: 'none' }
  | { action: 'join'; address: string }
  | { action: 'host' }
  | { action: 'leave-and-join'; address: string };

/** WSC primary device category 10 = telephone (phones and the tablets seen so far). */
export function isPhoneTypePeer(peer: Pick<WifiDirectPeerSighting, 'type'>): boolean {
  return /^10-/.test(peer.type);
}

export function planWifiOnlyFallback(input: {
  state: 'idle' | 'owner';
  clientCount: number;
  peers: readonly WifiDirectPeerSighting[];
  cooldownUntil: ReadonlyMap<string, number>;
  /** When phone-type peers were first seen continuously (null = none seen). */
  phonesSince: number | null;
  /** When this phone's group last had zero clients continuously (owner only). */
  emptySince: number | null;
  hostDelayMs: number;
  leaveDelayMs: number;
  now: number;
}): WifiOnlyPlan {
  const { now } = input;
  const fresh = input.peers.filter((peer) => now - peer.seenAt <= 30_000 && isPhoneTypePeer(peer));
  const owners = fresh
    .filter((peer) => peer.groupOwner && (input.cooldownUntil.get(peer.address) ?? 0) <= now)
    .sort((a, b) => a.address.localeCompare(b.address));
  if (input.state === 'owner') {
    if (input.clientCount > 0 || owners.length === 0 || input.emptySince === null) return { action: 'none' };
    return now - input.emptySince >= input.leaveDelayMs ? { action: 'leave-and-join', address: owners[0]!.address } : { action: 'none' };
  }
  if (owners.length > 0) return { action: 'join', address: owners[0]!.address };
  if (fresh.length > 0 && input.phonesSince !== null && now - input.phonesSince >= input.hostDelayMs) return { action: 'host' };
  return { action: 'none' };
}
