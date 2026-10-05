import { sha256Hex, type WifiDirectGroupCredentials } from './wifi-direct-link';
import { portableSha256Hex } from './portable-sha256';
import type { ActiveRoomScope } from './active-exchange-room';

/**
 * OPEN-36 offline mode: two Android phones find each other without the hub.
 *
 * - Same LAN: Android NSD (mDNS) finds the other phone's embedded node, and the page's Gun peers
 *   with it (`ws://<lan-ip>:<port>/gun`). Rosters, signaling and the WebRTC mesh then work as they
 *   do through the hub; host ICE candidates carry talks across the LAN.
 * - Different networks: Wi-Fi Direct DNS-SD service discovery. Every phone advertises a small TXT
 *   record; one phone hosts a group (deterministic election below). Phones in the same authenticated
 *   room scope derive rotating group credentials locally; credentials are never advertised.
 *   Android 10+ phones join by name + passphrase without a prompt. Gun peers with the group owner's
 *   node (`ws://192.168.49.1:<port>/gun`) and WebRTC uses each phone's loopback TURN relay on the
 *   group address (`local-link-turn-relay.ts`).
 *
 * Presence travels over BLE (8-byte service data, below). Wi-Fi Direct DNS-SD stays as a second
 * channel but proved unreliable on hardware: queries time out while the peer is off channel
 * serving its access point.
 *
 * Group credentials are derived from the short-lived active-room rendezvous token. They rotate
 * with room sessions and are only useful to a peer that already has that authenticated room
 * capability; the app never asks for or advertises the user's home/work Wi-Fi credentials.
 */

/** Per-room/session credentials. There is intentionally no app-wide fallback credential. */
export function deriveOfflineGroupCredentials(scope: ActiveRoomScope): WifiDirectGroupCredentials {
  const digest = portableSha256Hex(`iinpublic:wifi-direct-room:v1:${scope.roomToken}`);
  return {
    networkName: `DIRECT-iP-${digest.slice(0, 16)}`,
    passphrase: digest.slice(0, 32),
  };
}

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
  /** Opaque active-room rendezvous token. Raw room ids never enter radio records. */
  roomToken?: string;
  /** Host signal only. Credentials are derived locally from the already-held full room token. */
  hostingHint?: boolean;
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

export async function rotatingNearbyId(seaPub: string, nowMs: number = Date.now(), roomToken = ''): Promise<string> {
  const epoch = Math.floor(nowMs / NEARBY_ID_EPOCH_MS);
  return (await sha256Hex(`iinpublic-nearby:${seaPub}:${roomToken}:${epoch}`)).slice(0, 12);
}

const ID_PATTERN = /^[0-9a-f]{12}$/;
/** TXT keys stay short: Wi-Fi Direct service responses are small. */
export function encodeNearbyTxt(self: NearbySelf & { port: number; roomToken?: string; group?: WifiDirectGroupCredentials | null }): Record<string, string> {
  const txt: Record<string, string> = {
    v: NEARBY_TXT_VERSION,
    id: self.id,
    p: String(self.port),
    j: self.joinByCredential ? '1' : '0',
    s: String(Math.max(0, Math.min(3, Math.round(self.hostScore)))),
  };
  // Advertise only a short correlation prefix. A passive scanner cannot derive the group
  // passphrase; a legitimate room participant already holds the full authenticated token.
  if (self.roomToken) txt.r = self.roomToken.slice(0, 8);
  if (self.group) {
    txt.h = '1';
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
  const roomToken = text('r');
  if (roomToken) {
    if (!/^(?:[0-9a-f]{8}|[0-9a-f]{32})$/.test(roomToken)) return null;
    record.roomToken = roomToken;
  }
  if (text('h') === '1') record.hostingHint = true;
  return record;
}

/** RFC 1918 / link-local IPv4 — the only addresses a LAN Gun peer may use. */
export function isPrivateIpv4(address: string): boolean {
  const octets = String(address || '').split('.');
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = octets.map(Number) as [number, number];
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

/**
 * `http://<private-ipv4>:<port>/gun` from an NSD endpoint, or null for anything else. Wi-Fi Direct
 * group addresses (192.168.49.0/24) are refused: mDNS also answers across the group, and treating a
 * group peer as "same Wi-Fi" kept phones from re-forming a group for the LAN sighting's lifetime.
 */
export function lanGunPeerUrl(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string') return null;
  const match = /^http:\/\/([0-9.]+):(\d{1,5})\/gun$/.exec(endpoint.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (!isPrivateIpv4(match[1]!) || match[1]!.startsWith('192.168.49.') || port < 1 || port > 65535) return null;
  return `http://${match[1]}:${port}/gun`;
}

/** Host preference: the higher host score, then the lowest id. Every phone computes the same
 *  order. (The join-by-credential branch is moot offline — only Android 10+ phones take part.) */
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
  // Scoped credentials require Android 10+ APIs that can set (host) or join by credentials.
  // Android 7–9 phones use the shared-LAN path and are never waited on: their legacy groups get
  // framework-generated credentials the app cannot safely distribute.
  if (!self.joinByCredential) return { action: 'none', reason: 'cannot-join-by-credential' };
  const nearby = input.records.filter((record) =>
    record.id !== self.id && now - record.seenAt <= NEARBY_RECORD_TTL_MS && !input.lanIds.has(record.id) && record.joinByCredential);
  if (nearby.length === 0) return { action: 'none', reason: 'no-offline-peers' };

  const hosts = nearby
    .filter((record): record is NearbyRecord & { group: WifiDirectGroupCredentials } => !!record.group)
    .sort(hostRank);
  if (hosts.length > 0) return { action: 'join', record: hosts[0]! };

  if (!self.canHost) return { action: 'wait', reason: 'cannot-host' };
  const winner = [self, ...nearby].sort(hostRank)[0]!;
  return winner.id === self.id ? { action: 'host' } : { action: 'wait', reason: 'peer-hosts' };
}

/**
 * BLE presence payload (hex): version, 6-byte rotating id, flags — bit 0 hosting the offline group,
 * bit 1 joins by credential, bits 2–3 host score.
 */
export function encodeBlePresence(self: NearbySelf & { hosting: boolean; roomToken?: string }): string {
  const flags = (self.hosting ? 1 : 0) | (self.joinByCredential ? 2 : 0) | ((Math.max(0, Math.min(3, Math.round(self.hostScore))) & 3) << 2);
  if (self.roomToken) return `02${self.id}${self.roomToken.slice(0, 8)}${flags.toString(16).padStart(2, '0')}`;
  return `${BLE_PRESENCE_VERSION.toString(16).padStart(2, '0')}${self.id}${flags.toString(16).padStart(2, '0')}`;
}

export function parseBlePresence(payloadHex: unknown, seenAt: number, port: number, expectedRoomToken?: string): NearbyRecord | null {
  if (typeof payloadHex !== 'string' || !/^(?:[0-9a-f]{16}|[0-9a-f]{24})$/.test(payloadHex)) return null;
  const version = parseInt(payloadHex.slice(0, 2), 16);
  if (version !== BLE_PRESENCE_VERSION && version !== 2) return null;
  const id = payloadHex.slice(2, 14);
  const roomTokenPrefix = version === 2 ? payloadHex.slice(14, 22) : '';
  if (!expectedRoomToken || version !== 2 || !expectedRoomToken.startsWith(roomTokenPrefix)) return null;
  const flags = parseInt(payloadHex.slice(version === 2 ? 22 : 14, version === 2 ? 24 : 16), 16);
  const group = deriveOfflineGroupCredentials({ roomToken: expectedRoomToken } as ActiveRoomScope);
  return {
    id,
    port,
    joinByCredential: (flags & 2) !== 0,
    hostScore: (flags >> 2) & 3,
    seenAt,
    roomToken: expectedRoomToken,
    ...((flags & 1) !== 0 ? { group } : {}),
  };
}

// ── Wi-Fi-only fallback (no BLE, no DNS-SD) ──────────────────────────────────────────────────
// Plain P2P peer discovery is reliable even when DNS-SD frames keep missing (phones time-slicing
// their radio with an access point), but sightings carry no room scope. Room-scoped production
// mode therefore never uses this fallback to join an arbitrary owner.

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
