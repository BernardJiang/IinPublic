import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  microRoomControlScopeId,
  type MicroRoomAssignment,
} from '../../shared/micro-room-assignment';
import { createMicroRoomControlPresence } from '../../shared/micro-room-control-presence';
import {
  applyMicroRoomOverflowCertificateChain,
  type MicroRoomOverflowCertificate,
} from '../../shared/micro-room-overflow-certificate';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

const STORAGE_PREFIX = 'iinpublic_micro_room_certificates_v1:';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type FetchLike = typeof fetch;

export type MicroRoomPreAdmissionResult = {
  assignment: MicroRoomAssignment;
  certificates: MicroRoomOverflowCertificate[];
  relayReached: boolean;
};

export class MicroRoomPreAdmissionClient {
  constructor(private readonly options: {
    apiBase: string;
    storage: StorageLike;
    fetch?: FetchLike;
  }) {}

  async resolve(input: {
    userId: string;
    pair: SeaSigningPair;
    baseGridRoomId: string;
    checkpoint: RoomProtocolCheckpoint;
    minimumSplitGeneration?: number;
  }): Promise<MicroRoomPreAdmissionResult> {
    const fetchFn = this.options.fetch ?? fetch;
    const scopeId = microRoomControlScopeId(input.baseGridRoomId);
    let candidates: unknown[] = this.read(scopeId);
    const minimumSplitGeneration = input.minimumSplitGeneration ?? 0;
    let relayReached = false;
    let relayHighestSplitGeneration = -1;
    try {
      const response = await fetchFn(
        `${this.options.apiBase}/api/micro-rooms/control/${encodeURIComponent(scopeId)}/certificates?fromGeneration=${minimumSplitGeneration}`,
        { cache: 'no-store' },
      );
      if (response.ok) {
        const body = await response.json() as {
          certificates?: unknown[];
          highestSplitGeneration?: number;
        };
        candidates = this.merge(candidates, body.certificates ?? []);
        relayHighestSplitGeneration = Number.isSafeInteger(body.highestSplitGeneration)
          ? body.highestSplitGeneration!
          : -1;
        relayReached = true;
      }
    } catch {
      // Offline startup uses the last locally verified chain. Nearby control gossip is separate.
    }

    let chain = await applyMicroRoomOverflowCertificateChain({
      identity: input.pair.pub,
      baseGridRoomId: input.baseGridRoomId,
      currentSplitGeneration: minimumSplitGeneration,
      checkpoint: input.checkpoint,
      certificates: candidates,
    });
    this.append(scopeId, chain.accepted);

    for (let round = 0; round < 20; round += 1) {
      const assignment = chain.assignment;
      const presence = await createMicroRoomControlPresence({
        userId: input.userId,
        pair: input.pair,
        baseGridRoomId: input.baseGridRoomId,
        splitGeneration: assignment.splitGeneration,
        laneIndex: assignment.laneIndex,
        checkpoint: input.checkpoint,
      });
      let remote: unknown[];
      try {
        const response = await fetchFn(`${this.options.apiBase}/api/micro-rooms/control/presence`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseGridRoomId: input.baseGridRoomId,
            presence,
            // Repopulate an ephemeral relay only when it reports no certificate history. Normal
            // heartbeats send no historical C+1 bundles and receive only the current/new suffix.
            certificates: relayHighestSplitGeneration < 0 ? candidates : [],
          }),
        });
        if (!response.ok) break;
        const body = await response.json() as { certificates?: unknown[] };
        remote = body.certificates ?? [];
        relayHighestSplitGeneration = Math.max(
          relayHighestSplitGeneration,
          ...remote.flatMap((value) => {
            if (!value || typeof value !== 'object') return [];
            const generation = (value as Partial<MicroRoomOverflowCertificate>).fromSplitGeneration;
            return Number.isSafeInteger(generation) ? [generation!] : [];
          }),
        );
        relayReached = true;
      } catch {
        break;
      }
      candidates = this.merge(candidates, remote);
      const advanced = await applyMicroRoomOverflowCertificateChain({
        identity: input.pair.pub,
        baseGridRoomId: input.baseGridRoomId,
        currentSplitGeneration: minimumSplitGeneration,
        checkpoint: input.checkpoint,
        certificates: candidates,
      });
      this.append(scopeId, advanced.accepted);
      if (advanced.assignment.splitGeneration === assignment.splitGeneration) {
        return {
          assignment,
          certificates: advanced.accepted,
          relayReached,
        };
      }
      chain = advanced;
    }

    return {
      assignment: chain.assignment,
      certificates: chain.accepted,
      relayReached,
    };
  }

  private read(scopeId: string): unknown[] {
    try {
      const parsed = JSON.parse(this.options.storage.getItem(`${STORAGE_PREFIX}${scopeId}`) || '[]');
      return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
    } catch {
      return [];
    }
  }

  private append(scopeId: string, certificates: MicroRoomOverflowCertificate[]): void {
    if (certificates.length === 0) return;
    try {
      const merged = this.merge(this.read(scopeId), certificates).slice(0, 20);
      this.options.storage.setItem(
        `${STORAGE_PREFIX}${scopeId}`,
        JSON.stringify(merged),
      );
    } catch {
      // A full local store degrades to relay/nearby rediscovery; it never changes verification.
    }
  }

  private merge(left: unknown[], right: unknown[]): unknown[] {
    const merged = new Map<string, unknown>();
    for (const value of [...left, ...right].slice(0, 160)) {
      if (!value || typeof value !== 'object') continue;
      const record = value as Partial<MicroRoomOverflowCertificate>;
      const key = [
        record.controlScopeId,
        record.fromSplitGeneration,
        record.fromLaneIndex,
        record.createdAt,
      ].join(':');
      merged.set(key, value);
    }
    return [...merged.values()].slice(0, 160);
  }
}
