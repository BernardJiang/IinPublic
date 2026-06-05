/**
 * P2P-R — Local Trust Levels + Capability Gating
 *
 * Defines a four-level trust model for known peers and gates P2P capabilities
 * accordingly.  Reputation scores can recommend promotion/demotion but never
 * override an explicit `Blocked` or user-set trust level.
 *
 * REQ-P2P-11 / REQ-P2P-12 / REQ-P2P-18
 */

/** Four explicit trust levels for a known peer. */
export type TrustLevel = 'unknown' | 'friend' | 'verified' | 'blocked';

/**
 * Per-peer trust record stored locally (SEA-encrypted by the owner).
 * Extends the existing P2PNeighborTrustStatus concept with explicit levels.
 */
export type PeerTrustRecord = {
  version: 1;
  peerId: string;
  pub: string;
  /** Current trust level. */
  trustLevel: TrustLevel;
  /**
   * ISO-8601 timestamp of the last explicit user action on this record.
   * Null means the level was set by default.
   */
  setAt: string | null;
  /** True when the level was set by the user (not inferred from reputation). */
  userSet: boolean;
};

/**
 * A capability that can be gated by trust level.
 *
 * - `receive-broadcast`: peer can send/broadcast talks to us
 * - `initiate-contact`: peer can initiate contact/conversation
 * - `exchange-talks`: full talk exchange (answer, match, converse)
 * - `high-trust-affordances`: features that require explicit trust (e.g., verified badge display)
 */
export type TrustGatedCapability =
  | 'receive-broadcast'
  | 'initiate-contact'
  | 'exchange-talks'
  | 'high-trust-affordances';

/** Capability permission: the minimum trust level required to use each capability. */
export const CAPABILITY_TRUST_REQUIREMENTS: Record<TrustGatedCapability, TrustLevel[]> = {
  'receive-broadcast': ['unknown', 'friend', 'verified'],
  'initiate-contact': ['unknown', 'friend', 'verified'],
  'exchange-talks': ['friend', 'verified'],
  'high-trust-affordances': ['verified'],
};

/**
 * Returns true if a peer with the given trust level is allowed to perform the
 * requested capability.  Blocked peers are always denied.
 */
export function isTrustCapable(
  trustLevel: TrustLevel,
  capability: TrustGatedCapability,
): boolean {
  if (trustLevel === 'blocked') return false;
  return CAPABILITY_TRUST_REQUIREMENTS[capability].includes(trustLevel);
}

/**
 * Returns the complete set of capabilities a peer at this trust level can use.
 */
export function capabilitiesForTrustLevel(trustLevel: TrustLevel): TrustGatedCapability[] {
  if (trustLevel === 'blocked') return [];
  const all: TrustGatedCapability[] = [
    'receive-broadcast',
    'initiate-contact',
    'exchange-talks',
    'high-trust-affordances',
  ];
  return all.filter((c) => isTrustCapable(trustLevel, c));
}

/** Create a default trust record for a newly-seen peer. */
export function createDefaultPeerTrustRecord(
  peerId: string,
  pub: string,
): PeerTrustRecord {
  if (!peerId) throw new Error('peerId is required for trust record');
  if (!pub) throw new Error('pub is required for trust record');
  return {
    version: 1,
    peerId,
    pub,
    trustLevel: 'unknown',
    setAt: null,
    userSet: false,
  };
}

/**
 * Promote or demote a peer to a new trust level.
 *
 * Rules:
 * - Reputation may suggest promotion/demotion via `source: 'reputation'`
 *   but must never override an existing `userSet` record that is
 *   `blocked`, or demote below `friend` when the peer is `friend` or `verified`.
 * - User-initiated changes always win.
 */
export function applyTrustLevelChange(
  record: PeerTrustRecord,
  nextLevel: TrustLevel,
  opts: {
    source: 'user' | 'reputation';
    now?: Date;
  },
): PeerTrustRecord {
  const now = (opts.now ?? new Date()).toISOString();

  // Blocked always takes precedence; only a user can un-block.
  if (record.trustLevel === 'blocked' && record.userSet && opts.source !== 'user') {
    return record;
  }

  // Reputation cannot demote a user-set friend or verified record below their current level.
  if (opts.source === 'reputation' && record.userSet) {
    const ORDER: TrustLevel[] = ['unknown', 'friend', 'verified', 'blocked'];
    const currentIdx = ORDER.indexOf(record.trustLevel);
    const nextIdx = ORDER.indexOf(nextLevel);
    if (nextLevel !== 'blocked' && nextIdx < currentIdx) {
      return record;
    }
  }

  return {
    ...record,
    trustLevel: nextLevel,
    setAt: now,
    userSet: opts.source === 'user',
  };
}

/**
 * Derive a legacy `P2PNeighborTrustStatus` string from a `TrustLevel`.
 * `verified` and `friend` both map to `'trusted'` for backwards compatibility
 * with existing neighbor cache code.
 */
export function toLegacyTrustStatus(
  trustLevel: TrustLevel,
): 'trusted' | 'unknown' | 'blocked' {
  if (trustLevel === 'blocked') return 'blocked';
  if (trustLevel === 'friend' || trustLevel === 'verified') return 'trusted';
  return 'unknown';
}

/**
 * Upsert a trust record into a map keyed by peerId.
 * Ensures export-time idempotency: re-applying an identical record is a no-op.
 */
export function upsertPeerTrustRecord(
  store: Map<string, PeerTrustRecord>,
  record: PeerTrustRecord,
): void {
  const existing = store.get(record.peerId);
  if (existing && existing.trustLevel === record.trustLevel && existing.userSet === record.userSet) {
    return;
  }
  store.set(record.peerId, { ...record });
}

/**
 * Serialise the trust store to a plain array suitable for SEA encryption.
 * Re-importing produces an identical store (idempotency guarantee).
 */
export function exportTrustStore(store: Map<string, PeerTrustRecord>): PeerTrustRecord[] {
  return [...store.values()].sort((a, b) => a.peerId.localeCompare(b.peerId));
}

/**
 * Re-hydrate a trust store from an exported array.
 */
export function importTrustStore(records: PeerTrustRecord[]): Map<string, PeerTrustRecord> {
  const store = new Map<string, PeerTrustRecord>();
  for (const r of records) {
    if (r.peerId && r.pub) store.set(r.peerId, r);
  }
  return store;
}
