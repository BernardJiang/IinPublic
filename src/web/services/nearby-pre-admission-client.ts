import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { nearbyControlScopeId, createNearbyControlPresence } from '../../shared/nearby-control-presence';
import {
  applyNearbyOverflowCertificateChain,
  type NearbyOverflowCertificate,
} from '../../shared/nearby-overflow-certificate';
import type { NearbyPrivacyMode, NearbyRoomAssignment } from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { GPSCoordinate } from '../../shared/types';

const STORAGE_PREFIX = 'iinpublic_nearby_certificates_v1:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type FetchLike = typeof fetch;

export type NearbyPreAdmissionResult = {
  assignment: NearbyRoomAssignment;
  certificates: NearbyOverflowCertificate[];
  relayReached: boolean;
};

export class NearbyPreAdmissionClient {
  constructor(private readonly options: {
    apiBase: string;
    storage: StorageLike;
    fetch?: FetchLike;
  }) {}

  async resolve(input: {
    userId: string;
    pair: SeaSigningPair;
    location: GPSCoordinate;
    mode: NearbyPrivacyMode;
    rootAssignment: NearbyRoomAssignment;
    checkpoint: RoomProtocolCheckpoint;
  }): Promise<NearbyPreAdmissionResult> {
    const fetchFn = this.options.fetch ?? fetch;
    const scopeId = nearbyControlScopeId(input.rootAssignment.roomId);
    let candidates: unknown[] = this.read(scopeId);
    let relayReached = false;
    let relayHadCertificates = false;
    try {
      const response = await fetchFn(
        `${this.options.apiBase}/api/nearby-control/${encodeURIComponent(scopeId)}/certificates`
          + `?roomId=${encodeURIComponent(input.rootAssignment.roomId)}`
          + '&requestedSplitGeneration=0',
        { cache: 'no-store' },
      );
      if (response.ok) {
        const body = await response.json() as { certificates?: unknown[] };
        const remote = body.certificates ?? [];
        relayHadCertificates = remote.length > 0;
        candidates = this.merge(candidates, remote);
        relayReached = true;
      }
    } catch {
      // Offline startup uses the locally verified path until peers gossip newer evidence.
    }

    let chain = await applyNearbyOverflowCertificateChain({
      identity: input.pair.pub,
      location: input.location,
      mode: input.mode,
      rootAssignment: input.rootAssignment,
      checkpoint: input.checkpoint,
      certificates: candidates,
    });
    this.append(scopeId, chain.accepted);

    for (let round = 0; round < 20; round += 1) {
      const presence = await createNearbyControlPresence({
        userId: input.userId,
        pair: input.pair,
        rootRoomId: input.rootAssignment.roomId,
        assignment: chain.assignment,
        checkpoint: input.checkpoint,
      });
      let remote: unknown[];
      try {
        const response = await fetchFn(`${this.options.apiBase}/api/nearby-control/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            presence,
            // Rehydrate an ephemeral relay without making the relay authoritative.
            certificates: relayHadCertificates ? [] : this.rehydrationBundle(candidates),
          }),
        });
        if (!response.ok) break;
        const body = await response.json() as { certificates?: unknown[] };
        remote = body.certificates ?? [];
        if (remote.length > 0) relayHadCertificates = true;
        relayReached = true;
      } catch {
        break;
      }
      candidates = this.merge(candidates, remote);
      const advanced = await applyNearbyOverflowCertificateChain({
        identity: input.pair.pub,
        location: input.location,
        mode: input.mode,
        rootAssignment: input.rootAssignment,
        checkpoint: input.checkpoint,
        certificates: candidates,
      });
      this.append(scopeId, advanced.accepted);
      if (advanced.assignment.roomId === chain.assignment.roomId) {
        return { assignment: chain.assignment, certificates: advanced.accepted, relayReached };
      }
      chain = advanced;
    }
    return { assignment: chain.assignment, certificates: chain.accepted, relayReached };
  }

  private read(scopeId: string): unknown[] {
    try {
      const parsed = JSON.parse(this.options.storage.getItem(`${STORAGE_PREFIX}${scopeId}`) || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 160) : [];
    } catch {
      return [];
    }
  }

  private append(scopeId: string, certificates: NearbyOverflowCertificate[]): void {
    if (certificates.length === 0) return;
    try {
      this.options.storage.setItem(
        `${STORAGE_PREFIX}${scopeId}`,
        JSON.stringify(this.merge(this.read(scopeId), certificates).slice(0, 160)),
      );
    } catch {
      // Full local storage falls back to relay/peer rediscovery without weakening verification.
    }
  }

  private merge(left: unknown[], right: unknown[]): unknown[] {
    const merged = new Map<string, unknown>();
    for (const value of [...left, ...right].slice(0, 640)) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Partial<NearbyOverflowCertificate>;
      const key = [
        record.controlScopeId,
        record.fromRequestedSplitGeneration,
        record.fromRoomId,
        record.createdAt,
      ].join(':');
      merged.set(key, value);
    }
    return [...merged.values()].slice(0, 160);
  }

  /** Stay below the server's 10 MB JSON limit even with C+1 witness bundles. */
  private rehydrationBundle(candidates: unknown[]): unknown[] {
    const retained: unknown[] = [];
    let bytes = 0;
    for (const candidate of candidates) {
      let size: number;
      try {
        size = JSON.stringify(candidate).length;
      } catch {
        continue;
      }
      if (bytes + size > 7_500_000) break;
      retained.push(candidate);
      bytes += size;
    }
    return retained;
  }
}
