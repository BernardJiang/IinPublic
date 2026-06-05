/**
 * P2P-W — Bridge between p2p-trust.ts (TrustLevel) and p2p-runtime.ts
 * (P2PNeighborRecord / P2PNeighborTrustStatus).
 *
 * Kept separate to avoid circular imports between the two shared modules.
 */

import type { P2PNeighborRecord, P2PNeighborTrustStatus } from './p2p-runtime';
import {
  isTrustCapable,
  toLegacyTrustStatus,
  type PeerTrustRecord,
  type TrustGatedCapability,
  type TrustLevel,
} from './p2p-trust';

/**
 * Derive a `TrustLevel` from an existing `P2PNeighborRecord.trustStatus`.
 * `'trusted'` maps to `'friend'` (the lesser of the two explicit levels)
 * because we cannot distinguish friend from verified from the legacy field alone.
 */
export function trustLevelFromNeighborRecord(record: P2PNeighborRecord): TrustLevel {
  if (record.trustStatus === 'blocked') return 'blocked';
  if (record.trustStatus === 'trusted') return 'friend';
  return 'unknown';
}

/**
 * Return a copy of `record` with `trustStatus` updated to reflect the supplied
 * `PeerTrustRecord.trustLevel` via `toLegacyTrustStatus`.
 *
 * Call this on every `upsertP2PNeighbor` that has a corresponding trust record.
 */
export function neighborRecordWithTrust(
  record: P2PNeighborRecord,
  trustRecord: PeerTrustRecord,
): P2PNeighborRecord {
  const status: P2PNeighborTrustStatus = toLegacyTrustStatus(trustRecord.trustLevel);
  return { ...record, trustStatus: status };
}

/**
 * Returns true when a peer (identified by `trustRecord`) has the capability to
 * have their talk offer accepted.
 *
 * Defaults to `'receive-broadcast'` but callers can pass other capabilities.
 */
export function isTrustCapableForOffer(
  trustRecord: PeerTrustRecord | undefined,
  capability: TrustGatedCapability = 'receive-broadcast',
): boolean {
  if (!trustRecord) {
    // No explicit trust record → treat as unknown (defaults allowed)
    return isTrustCapable('unknown', capability);
  }
  return isTrustCapable(trustRecord.trustLevel, capability);
}
