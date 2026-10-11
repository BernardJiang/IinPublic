import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyControlPresence } from '../../shared/nearby-control-presence';
import type { NearbyOverflowCertificate } from '../../shared/nearby-overflow-certificate';
import {
  applyNearbyPartitionTransitions,
  NEARBY_PARTITION_MAX_CHAIN,
  nearbyPartitionRootGroup,
  parseNearbyPartitionTransition,
  type NearbyPartitionTransition,
  type VerifiedNearbyPartitionTransition,
} from '../../shared/nearby-partition';
import {
  isNearbyPublicMode,
  type NearbyPrivacyMode,
  type NearbyPublicMode,
  type NearbyRoomAssignment,
} from '../../shared/nearby-rooms';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import type { GPSCoordinate } from '../../shared/types';

const STORAGE_PREFIX = 'iinpublic_nearby_partition_lineage_v1:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type FetchLike = typeof fetch;

export type NearbyPreAdmissionResult = {
  assignment: NearbyRoomAssignment;
  /** Retained for mixed-release callers. Adaptive v2 uses transitions instead. */
  certificates: NearbyOverflowCertificate[];
  transitions: NearbyPartitionTransition[];
  relayReached: boolean;
};

/**
 * Resolve the user's declared point through a verified flat replacement lineage before room
 * presence starts. Only this point's lineage is fetched and cached; unrelated room rosters and
 * partition branches are never downloaded.
 */
export class NearbyPreAdmissionClient {
  private readonly verificationCache = new Map<string, VerifiedNearbyPartitionTransition>();

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
    if (!isNearbyPublicMode(input.mode)) throw new Error('adaptive Nearby requires a public location mode');
    const mode: NearbyPublicMode = input.mode;
    const root = nearbyPartitionRootGroup(input.checkpoint);
    let candidates: unknown[] = this.read(root.roomId);
    let resolved = await applyNearbyPartitionTransitions({
      location: input.location,
      mode,
      identity: input.pair.pub,
      checkpoint: input.checkpoint,
      transitions: candidates,
      verificationCache: this.verificationCache,
    });
    let relayReached = false;
    const fetchFn = this.options.fetch ?? fetch;

    for (let round = 0; round < 40; round += 1) {
      const beforeFetchRoomId = resolved.assignment.roomId;
      try {
        const response = await fetchFn(
          `${this.options.apiBase}/api/nearby-partitions/${encodeURIComponent(beforeFetchRoomId)}/transition`
            + `?networkId=${encodeURIComponent(input.checkpoint.networkId)}`
            + `&protocolEpoch=${input.checkpoint.protocolEpoch}`
            + `&manifestSequence=${input.checkpoint.manifestSequence}`
            + `&manifestHash=${input.checkpoint.manifestHash}`
            + `&chatroomCapacity=${input.checkpoint.chatroomCapacity}`,
          { cache: 'no-store' },
        );
        if (response.ok) {
          const body = await response.json() as { transitions?: unknown[] };
          candidates = this.merge(candidates, body.transitions ?? []);
          relayReached = true;
          resolved = await applyNearbyPartitionTransitions({
            location: input.location,
            mode,
            identity: input.pair.pub,
            checkpoint: input.checkpoint,
            transitions: candidates,
            verificationCache: this.verificationCache,
          });
          this.write(root.roomId, resolved.accepted);
          if (resolved.assignment.roomId !== beforeFetchRoomId) continue;
        }
      } catch {
        // A disconnected phone continues only from its cached verified lineage.
      }

      const presence = await createNearbyControlPresence({
        userId: input.userId,
        pair: input.pair,
        rootRoomId: root.roomId,
        assignment: resolved.assignment,
        checkpoint: input.checkpoint,
      });
      let remote: unknown[] = [];
      let response: Response;
      try {
        response = await fetchFn(`${this.options.apiBase}/api/nearby-partitions/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            presence,
            // Rehydrate a restarted rendezvous index from this device's verified lineage.
            transitions: this.rehydrationBundle(candidates),
          }),
        });
      } catch {
        break;
      }
      if (!response.ok) {
        let message = `Nearby partition admission failed (${response.status})`;
        try {
          const body = await response.json() as { error?: unknown };
          if (body.error) message = String(body.error);
        } catch {
          // Keep the bounded status-only error when the relay returns no JSON.
        }
        throw new Error(message);
      }
      const body = await response.json() as { transitions?: unknown[] };
      remote = body.transitions ?? [];
      relayReached = true;
      candidates = this.merge(candidates, remote);
      const advanced = await applyNearbyPartitionTransitions({
        location: input.location,
        mode,
        identity: input.pair.pub,
        checkpoint: input.checkpoint,
        transitions: candidates,
        verificationCache: this.verificationCache,
      });
      this.write(root.roomId, advanced.accepted);
      if (advanced.assignment.roomId === resolved.assignment.roomId) {
        return {
          assignment: advanced.assignment,
          certificates: [],
          transitions: advanced.accepted,
          relayReached,
        };
      }
      resolved = advanced;
    }

    return {
      assignment: resolved.assignment,
      certificates: [],
      transitions: resolved.accepted,
      relayReached,
    };
  }

  private read(rootRoomId: string): unknown[] {
    try {
      const value = JSON.parse(this.options.storage.getItem(`${STORAGE_PREFIX}${rootRoomId}`) || '[]');
      return Array.isArray(value) ? value.slice(0, NEARBY_PARTITION_MAX_CHAIN) : [];
    } catch {
      return [];
    }
  }

  private write(rootRoomId: string, transitions: NearbyPartitionTransition[]): void {
    if (transitions.length === 0) return;
    try {
      this.options.storage.setItem(
        `${STORAGE_PREFIX}${rootRoomId}`,
        JSON.stringify(this.merge(this.read(rootRoomId), transitions)),
      );
    } catch {
      // Storage exhaustion loses only offline lineage reuse; live verification remains required.
    }
  }

  private merge(left: unknown[], right: unknown[]): NearbyPartitionTransition[] {
    const merged = new Map<string, NearbyPartitionTransition>();
    for (const value of [...left, ...right].slice(0, NEARBY_PARTITION_MAX_CHAIN * 4)) {
      const transition = parseNearbyPartitionTransition(value);
      if (transition) merged.set(transition.transitionId, transition);
    }
    return [...merged.values()].slice(-NEARBY_PARTITION_MAX_CHAIN);
  }

  private rehydrationBundle(candidates: unknown[]): unknown[] {
    const retained: unknown[] = [];
    let bytes = 0;
    for (const candidate of candidates.slice(-NEARBY_PARTITION_MAX_CHAIN)) {
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
