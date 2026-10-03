/**
 * Hub-matchmade Wi-Fi Direct link upgrade (TODO OPEN-36).
 *
 * Two Android peers that already share a SEA-authenticated WebRTC session, but whose selected
 * ICE pair is not a same-LAN host↔host pair, negotiate a Wi-Fi Direct group over that session's
 * signed DataChannel and then restart ICE so WebRTC re-selects a host pair on the
 * `192.168.49.x` group subnet. Wi-Fi Direct only supplies the IP link; talk bodies keep flowing
 * over the same DTLS DataChannel, so the group owner never sees plaintext.
 *
 * Group credentials travel only inside DTLS + SEA-signed DataChannel frames, never via the hub.
 */

export const WIFI_DIRECT_LINK_PROTOCOL_VERSION = 1;
/** Wait this long after a session connects before judging its path (ICE may still be settling). */
export const WIFI_DIRECT_PATH_DECISION_DELAY_MS = 3_000;
/** Whole upgrade (hello → group → join → ICE restart → verified path) must finish within this. */
export const WIFI_DIRECT_UPGRADE_TIMEOUT_MS = 60_000;
/** After a failed upgrade with a peer, do not retry it for this long. */
export const WIFI_DIRECT_RETRY_COOLDOWN_MS = 10 * 60_000;
/** Remove an owned/joined group once no linked peer has used it for this long. */
export const WIFI_DIRECT_IDLE_TEARDOWN_MS = 60_000;
/** Android's Wi-Fi Direct group owner always takes this address on the group interface. */
export const WIFI_DIRECT_GROUP_OWNER_IP = '192.168.49.1';

export type WifiDirectGroupCredentials = {
  /** Must start with `DIRECT-xy` (Android `WifiP2pConfig.Builder.setNetworkName` contract). */
  networkName: string;
  /** WPA2 passphrase, 8–63 ASCII characters. */
  passphrase: string;
  /** Group owner's P2P device address — needed by Android < 10 clients, which can only join via
   *  classic `connect(deviceAddress)` negotiation (shows the system prompt on the owner). */
  ownerDeviceAddress?: string;
  /** Group operating frequency (MHz). A joiner scans only this channel — without it, a phone whose
   *  own Wi-Fi is on 2.4 GHz never finds a group owner sitting on its 5 GHz station channel. */
  frequencyMhz?: number;
};

/** What a peer advertises about its own Wi-Fi Direct situation. */
export type WifiDirectPeerInfo = {
  /** Device can create a group (FEATURE_WIFI_DIRECT + permission). */
  canHost: boolean;
  /** Android 10+: can join a group by name + passphrase without the pairing prompt. */
  joinByCredential: boolean;
  /** Higher hosts first: charging / battery state (0–3). */
  hostScore: number;
  /** Present when the device is already in a group (owner or client) others may join. */
  group?: WifiDirectGroupCredentials & { role: 'owner' | 'client' };
};

export type WifiDirectLinkMessage =
  | { v: 1; kind: 'wd-hello'; linkId: string; info: WifiDirectPeerInfo }
  | { v: 1; kind: 'wd-group'; linkId: string; credentials: WifiDirectGroupCredentials }
  | { v: 1; kind: 'wd-joined'; linkId: string }
  /** Sender's loopback relay is up on its group address. */
  | { v: 1; kind: 'wd-ready'; linkId: string }
  /** Initiator → responder: both relays are up; replace the connection with a relay-only one now. */
  | { v: 1; kind: 'wd-switch'; linkId: string }
  | { v: 1; kind: 'wd-active'; linkId: string }
  | { v: 1; kind: 'wd-abort'; linkId: string; reason: string };

export type WifiDirectPlan =
  /** Local device hosts: create a new group (or reuse its existing owned group). */
  | { action: 'host'; reuseExisting: boolean }
  /** Local device joins the group described by `credentials`. */
  | { action: 'join'; credentials: WifiDirectGroupCredentials }
  /** Remote side hosts/creates; local waits for `wd-group` and then joins. */
  | { action: 'await-group' }
  /** Already in the same group — just restart ICE. */
  | { action: 'already-linked' }
  | { action: 'abort'; reason: string };

/** Lowercase hex SHA-256 — used for the offline-computable host tie-break. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Decide who hosts. Both peers run this with mirrored inputs and reach complementary plans.
 * Rules, in order (OPEN-36): (1) join an existing group rather than forming a new one;
 * (2) only a device that can host may host; (3) a pre-Android-10 device hosts so the other side
 * joins prompt-free; (4) higher hostScore hosts; (5) lowest SHA-256(SEA pub) hosts.
 */
export async function planWifiDirectLink(params: {
  localPub: string;
  remotePub: string;
  local: WifiDirectPeerInfo;
  remote: WifiDirectPeerInfo;
}): Promise<WifiDirectPlan> {
  const { local, remote } = params;
  const localGroup = local.group;
  const remoteGroup = remote.group;
  if (localGroup && remoteGroup) {
    if (localGroup.networkName === remoteGroup.networkName) return { action: 'already-linked' };
    return { action: 'abort', reason: 'both-in-different-groups' };
  }
  if (remoteGroup) return { action: 'join', credentials: stripRole(remoteGroup) };
  // Remote joins the local group; a local *client* re-shares the credentials it joined with.
  if (localGroup) return { action: 'host', reuseExisting: true };

  if (!local.canHost && !remote.canHost) return { action: 'abort', reason: 'no-host-capable-peer' };
  if (local.canHost && !remote.canHost) return { action: 'host', reuseExisting: false };
  if (!local.canHost && remote.canHost) return { action: 'await-group' };

  // A pre-Android-10 device can only join via classic negotiation, which prompts on the owner;
  // when it hosts instead, the Android 10+ side joins by name + passphrase with no prompt at all.
  if (local.joinByCredential !== remote.joinByCredential) {
    return local.joinByCredential ? { action: 'await-group' } : { action: 'host', reuseExisting: false };
  }
  if (local.hostScore !== remote.hostScore) {
    return local.hostScore > remote.hostScore ? { action: 'host', reuseExisting: false } : { action: 'await-group' };
  }
  const [localHash, remoteHash] = await Promise.all([sha256Hex(params.localPub), sha256Hex(params.remotePub)]);
  if (localHash === remoteHash) return { action: 'abort', reason: 'identical-identity' };
  return localHash < remoteHash ? { action: 'host', reuseExisting: false } : { action: 'await-group' };
}

/** Credentials without any extra fields (role, …) — the exact shape sent in `wd-group`. */
export function joinableCredentials(group: WifiDirectGroupCredentials): WifiDirectGroupCredentials {
  return {
    networkName: group.networkName,
    passphrase: group.passphrase,
    ...(group.ownerDeviceAddress ? { ownerDeviceAddress: group.ownerDeviceAddress } : {}),
    ...(group.frequencyMhz ? { frequencyMhz: group.frequencyMhz } : {}),
  };
}

function stripRole(group: WifiDirectGroupCredentials & { role: 'owner' | 'client' }): WifiDirectGroupCredentials {
  return joinableCredentials(group);
}

/** Selected-ICE-pair classification read from `RTCPeerConnection.getStats()`. */
export type SelectedPathKind = 'wifi-direct' | 'lan' | 'internet' | 'relay' | 'unknown';

export type SelectedCandidatePair = {
  localType: string | undefined;
  localAddress: string | undefined;
  remoteType: string | undefined;
  remoteAddress: string | undefined;
};

export function isWifiDirectGroupAddress(address: string | undefined): boolean {
  return !!address && /^192\.168\.49\.\d{1,3}$/.test(address);
}

/**
 * host↔host = same LAN (no upgrade needed). A host pair on 192.168.49.0/24 is the Wi-Fi Direct
 * group subnet. mDNS-obfuscated host candidates (`*.local`) still count as host.
 */
export function classifySelectedPath(pair: SelectedCandidatePair | null): SelectedPathKind {
  if (!pair || !pair.localType || !pair.remoteType) return 'unknown';
  // Before the relay check: the upgrade's own path is relay↔relay through each device's loopback
  // TURN relay, whose relayed addresses are on the group subnet.
  if (isWifiDirectGroupAddress(pair.localAddress) && isWifiDirectGroupAddress(pair.remoteAddress)) return 'wifi-direct';
  if (pair.localType === 'relay' || pair.remoteType === 'relay') return 'relay';
  const localNear = pair.localType === 'host' || pair.localType === 'prflx';
  const remoteNear = pair.remoteType === 'host' || pair.remoteType === 'prflx';
  if (localNear && remoteNear && (pair.localType === 'host' || pair.remoteType === 'host')) return 'lan';
  return 'internet';
}

/** Read the nominated/selected candidate pair from a stats report. */
export function selectedCandidatePairFromStats(stats: Iterable<[string, Record<string, unknown>]> | Map<string, Record<string, unknown>>): SelectedCandidatePair | null {
  const byId = new Map<string, Record<string, unknown>>();
  for (const [id, report] of stats as Iterable<[string, Record<string, unknown>]>) byId.set(id, report);
  let pair: Record<string, unknown> | undefined;
  for (const report of byId.values()) {
    if (report.type === 'transport' && typeof report.selectedCandidatePairId === 'string') {
      pair = byId.get(report.selectedCandidatePairId);
      if (pair) break;
    }
  }
  if (!pair) {
    for (const report of byId.values()) {
      if (report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated === true || report.selected === true)) {
        pair = report;
        break;
      }
    }
  }
  if (!pair) return null;
  const local = byId.get(String(pair.localCandidateId));
  const remote = byId.get(String(pair.remoteCandidateId));
  return {
    localType: stringField(local, 'candidateType'),
    localAddress: stringField(local, 'address') ?? stringField(local, 'ip'),
    remoteType: stringField(remote, 'candidateType'),
    remoteAddress: stringField(remote, 'address') ?? stringField(remote, 'ip'),
  };
}

function stringField(report: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = report?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

const NETWORK_NAME_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Fresh group credentials for Android 10+ `createGroup(config)`. */
export function generateWifiDirectGroupCredentials(random: (length: number) => Uint8Array = defaultRandom): WifiDirectGroupCredentials {
  const nameBytes = random(2);
  const suffix = [...nameBytes].map((byte) => NETWORK_NAME_ALPHABET[byte % NETWORK_NAME_ALPHABET.length]).join('');
  const passphrase = [...random(16)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { networkName: `DIRECT-${suffix}-IinPublic`, passphrase };
}

function defaultRandom(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function newWifiDirectLinkId(random: (length: number) => Uint8Array = defaultRandom): string {
  return `wd_${[...random(8)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function isCredentials(value: unknown): value is WifiDirectGroupCredentials {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.networkName === 'string' &&
    /^DIRECT-.{2}/.test(record.networkName) &&
    record.networkName.length <= 32 &&
    typeof record.passphrase === 'string' &&
    record.passphrase.length >= 8 &&
    record.passphrase.length <= 63 &&
    (record.ownerDeviceAddress === undefined || (typeof record.ownerDeviceAddress === 'string' && /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(record.ownerDeviceAddress))) &&
    (record.frequencyMhz === undefined || (Number.isInteger(record.frequencyMhz) && Number(record.frequencyMhz) >= 2400 && Number(record.frequencyMhz) <= 7125))
  );
}

function isPeerInfo(value: unknown): value is WifiDirectPeerInfo {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  if (typeof record.canHost !== 'boolean' || typeof record.joinByCredential !== 'boolean') return false;
  if (typeof record.hostScore !== 'number' || !Number.isFinite(record.hostScore) || record.hostScore < 0 || record.hostScore > 3) return false;
  if (record.group === undefined) return true;
  const role = (record.group as Record<string, unknown>).role;
  return isCredentials(record.group) && (role === 'owner' || role === 'client');
}

/** Structural validation of an inbound link frame (the DataChannel already verified the signature). */
export function parseWifiDirectLinkMessage(value: unknown): WifiDirectLinkMessage | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.v !== WIFI_DIRECT_LINK_PROTOCOL_VERSION) return null;
  if (typeof record.linkId !== 'string' || !/^wd_[0-9a-f]{16}$/.test(record.linkId)) return null;
  switch (record.kind) {
    case 'wd-hello':
      return isPeerInfo(record.info) ? (record as WifiDirectLinkMessage) : null;
    case 'wd-group':
      return isCredentials(record.credentials) ? (record as WifiDirectLinkMessage) : null;
    case 'wd-joined':
    case 'wd-ready':
    case 'wd-switch':
    case 'wd-active':
      return record as WifiDirectLinkMessage;
    case 'wd-abort':
      return typeof record.reason === 'string' && record.reason.length <= 64 ? (record as WifiDirectLinkMessage) : null;
    default:
      return null;
  }
}
