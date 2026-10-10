import {
  parseNearbyControlPresence,
  verifyNearbyControlPresence,
  type NearbyControlPresence,
} from '../../shared/nearby-control-presence';
import {
  createNearbyOverflowCertificate,
  verifyNearbyOverflowCertificate,
  type NearbyOverflowCertificate,
} from '../../shared/nearby-overflow-certificate';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';

const MAX_CONTROL_SCOPES = 1_024;
const MAX_ROOM_BUCKETS_PER_SCOPE = 512;
const MAX_CERTIFICATES_PER_SCOPE = 512;

type ScopeState = {
  touchedAt: number;
  presenceByRoom: Map<string, Map<string, NearbyControlPresence>>;
  certificates: Map<string, NearbyOverflowCertificate>;
  certificateFormation: Map<string, Promise<void>>;
};

export type NearbyControlRegistration = {
  record: NearbyControlPresence;
  roomWitnessCount: number;
  certificates: NearbyOverflowCertificate[];
};

/** Bounded relay transport for evidence; clients remain the admission-policy verifiers. */
export class NearbyControlStore {
  private readonly scopes = new Map<string, ScopeState>();

  clear(): void {
    this.scopes.clear();
  }

  async register(value: unknown, now = new Date()): Promise<NearbyControlRegistration> {
    const parsed = parseNearbyControlPresence(value);
    if (!parsed) throw new Error('malformed Nearby control presence');
    const verification = await verifyNearbyControlPresence(parsed, {
      expectedCheckpoint: parsed.checkpoint,
      at: now,
    });
    if (!verification.ok) throw new Error(verification.reason);
    const record = verification.record;
    const scope = this.getOrCreateScope(record.controlScopeId, now.getTime());
    this.pruneScope(scope, now);
    const roomKey = this.roomKey(
      record.requestedSplitGeneration,
      record.roomId,
      record.checkpoint,
    );
    let room = scope.presenceByRoom.get(roomKey);
    if (!room) {
      this.retainBoundedRoomCount(scope);
      room = new Map<string, NearbyControlPresence>();
      scope.presenceByRoom.set(roomKey, room);
    }
    room.set(record.pub, record);
    const capacity = record.checkpoint.chatroomCapacity;
    const retained = [...room.values()]
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
        || left.pub.localeCompare(right.pub))
      .slice(0, capacity + 1);
    room = new Map(retained.map((candidate) => [candidate.pub, candidate]));
    scope.presenceByRoom.set(roomKey, room);

    if (room.size === capacity + 1 && !scope.certificates.has(roomKey)) {
      let formation = scope.certificateFormation.get(roomKey);
      if (!formation) {
        const witnesses = [...room.values()];
        formation = (async () => {
          const certificate = createNearbyOverflowCertificate({
            rootRoomId: record.rootRoomId,
            fromRoomId: record.roomId,
            fromRequestedSplitGeneration: record.requestedSplitGeneration,
            checkpoint: record.checkpoint,
            witnesses,
            createdAt: now.toISOString(),
          });
          const verified = await verifyNearbyOverflowCertificate(certificate, {
            expectedCheckpoint: record.checkpoint,
            now,
          });
          if (!verified.ok) throw new Error(verified.reason);
          this.retainBoundedCertificateCount(scope);
          scope.certificates.set(roomKey, verified.certificate);
        })();
        scope.certificateFormation.set(roomKey, formation);
        void formation.finally(() => {
          if (scope.certificateFormation.get(roomKey) === formation) {
            scope.certificateFormation.delete(roomKey);
          }
        }).catch(() => undefined);
      }
      await formation;
    }
    scope.touchedAt = now.getTime();
    return {
      record,
      roomWitnessCount: room.size,
      certificates: this.listForRoom(
        record.controlScopeId,
        record.roomId,
        record.requestedSplitGeneration,
      ),
    };
  }

  async publishCertificates(values: unknown[], now = new Date()): Promise<NearbyOverflowCertificate[]> {
    for (const value of values.slice(0, 160)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<NearbyOverflowCertificate>;
      if (!candidate.checkpoint) continue;
      const verification = await verifyNearbyOverflowCertificate(candidate, {
        expectedCheckpoint: candidate.checkpoint,
        now,
      });
      if (!verification.ok) continue;
      const record = verification.certificate;
      const scope = this.getOrCreateScope(record.controlScopeId, now.getTime());
      const key = this.roomKey(
        record.fromRequestedSplitGeneration,
        record.fromRoomId,
        record.checkpoint,
      );
      if (!scope.certificates.has(key)) {
        this.retainBoundedCertificateCount(scope);
        scope.certificates.set(key, record);
      }
      scope.touchedAt = now.getTime();
    }
    const first = values.find((value): value is NearbyOverflowCertificate =>
      !!value && typeof value === 'object' && typeof (value as NearbyOverflowCertificate).controlScopeId === 'string');
    return first ? this.listForRoom(
      first.controlScopeId,
      first.fromRoomId,
      first.fromRequestedSplitGeneration,
    ) : [];
  }

  list(controlScopeId: string): NearbyOverflowCertificate[] {
    const scope = this.scopes.get(controlScopeId);
    if (!scope) return [];
    return [...scope.certificates.values()]
      .sort((left, right) => left.fromRequestedSplitGeneration - right.fromRequestedSplitGeneration
        || left.fromRoomId.localeCompare(right.fromRoomId))
      .slice(0, MAX_CERTIFICATES_PER_SCOPE);
  }

  listForRoom(
    controlScopeId: string,
    roomId: string,
    requestedSplitGeneration: number,
  ): NearbyOverflowCertificate[] {
    return this.list(controlScopeId).filter((certificate) =>
      certificate.fromRoomId === roomId
      && certificate.fromRequestedSplitGeneration === requestedSplitGeneration);
  }

  private roomKey(
    generation: number,
    roomId: string,
    checkpoint: RoomProtocolCheckpoint,
  ): string {
    return [
      generation,
      roomId,
      checkpoint.networkId,
      checkpoint.protocolEpoch,
      checkpoint.manifestSequence,
      checkpoint.manifestHash,
      checkpoint.chatroomCapacity,
    ].join(':');
  }

  private getOrCreateScope(controlScopeId: string, nowMs: number): ScopeState {
    let scope = this.scopes.get(controlScopeId);
    if (scope) return scope;
    if (this.scopes.size >= MAX_CONTROL_SCOPES) {
      const oldest = [...this.scopes.entries()]
        .sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0];
      if (oldest) this.scopes.delete(oldest[0]);
    }
    scope = {
      touchedAt: nowMs,
      presenceByRoom: new Map(),
      certificates: new Map(),
      certificateFormation: new Map(),
    };
    this.scopes.set(controlScopeId, scope);
    return scope;
  }

  private pruneScope(scope: ScopeState, now: Date): void {
    for (const [roomKey, room] of scope.presenceByRoom) {
      for (const [pub, record] of room) {
        if (Date.parse(record.expiresAt) <= now.getTime()) room.delete(pub);
      }
      if (room.size === 0) scope.presenceByRoom.delete(roomKey);
    }
  }

  private retainBoundedRoomCount(scope: ScopeState): void {
    if (scope.presenceByRoom.size < MAX_ROOM_BUCKETS_PER_SCOPE) return;
    const stalest = [...scope.presenceByRoom.entries()]
      .sort((left, right) => {
        const leftNewest = Math.max(...[...left[1].values()].map((record) => Date.parse(record.observedAt)));
        const rightNewest = Math.max(...[...right[1].values()].map((record) => Date.parse(record.observedAt)));
        return leftNewest - rightNewest;
      })[0];
    if (stalest) scope.presenceByRoom.delete(stalest[0]);
  }

  private retainBoundedCertificateCount(scope: ScopeState): void {
    if (scope.certificates.size < MAX_CERTIFICATES_PER_SCOPE) return;
    const oldest = [...scope.certificates.entries()]
      .sort((left, right) => Date.parse(left[1].createdAt) - Date.parse(right[1].createdAt))[0];
    if (oldest) scope.certificates.delete(oldest[0]);
  }
}
