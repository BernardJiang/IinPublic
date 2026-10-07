import {
  parseMicroRoomControlPresence,
  verifyMicroRoomControlPresence,
  type MicroRoomControlPresence,
} from '../../shared/micro-room-control-presence';
import {
  createMicroRoomOverflowCertificate,
  verifyMicroRoomOverflowCertificate,
  type MicroRoomOverflowCertificate,
} from '../../shared/micro-room-overflow-certificate';
import { microRoomControlScopeId } from '../../shared/micro-room-assignment';

const MAX_CONTROL_SCOPES = 1_024;
const MAX_LANES_PER_SCOPE = 128;

type ScopeState = {
  touchedAt: number;
  lanePresence: Map<string, Map<string, MicroRoomControlPresence>>;
  certificates: Map<number, MicroRoomOverflowCertificate>;
  certificateFormation: Map<number, Promise<void>>;
};

export type MicroRoomControlRegistration = {
  record: MicroRoomControlPresence;
  laneWitnessCount: number;
  certificates: MicroRoomOverflowCertificate[];
};

/**
 * Relay-only, bounded transport for ownerless control evidence. It never decides admission: every
 * client verifies the returned certificate chain against its own release checkpoint.
 */
export class MicroRoomControlStore {
  private readonly scopes = new Map<string, ScopeState>();

  clear(): void {
    this.scopes.clear();
  }

  async register(
    baseGridRoomId: string,
    value: unknown,
    now = new Date(),
  ): Promise<MicroRoomControlRegistration> {
    const parsed = parseMicroRoomControlPresence(value);
    if (!parsed) throw new Error('malformed micro-room control presence');
    const verification = await verifyMicroRoomControlPresence(parsed, {
      baseGridRoomId,
      expectedCheckpoint: parsed.checkpoint,
      at: now,
    });
    if (!verification.ok) throw new Error(verification.reason);
    const record = verification.record;
    const scope = this.getOrCreateScope(record.controlScopeId, now.getTime());
    this.pruneScope(scope, now);
    const laneKey = `${record.splitGeneration}:${record.laneIndex}`;
    let lane = scope.lanePresence.get(laneKey);
    if (!lane) {
      this.retainBoundedLaneCount(scope);
      lane = new Map<string, MicroRoomControlPresence>();
      scope.lanePresence.set(laneKey, lane);
    }
    lane.set(record.pub, record);
    const capacity = record.checkpoint.chatroomCapacity;
    const retained = [...lane.values()]
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
        || left.pub.localeCompare(right.pub))
      .slice(0, capacity + 1);
    lane = new Map(retained.map((candidate) => [candidate.pub, candidate]));
    scope.lanePresence.set(laneKey, lane);

    if (lane.size === capacity + 1 && !scope.certificates.has(record.splitGeneration)) {
      let formation = scope.certificateFormation.get(record.splitGeneration);
      if (!formation) {
        const witnesses = [...lane.values()];
        formation = (async () => {
          const certificate = createMicroRoomOverflowCertificate({
            baseGridRoomId,
            fromSplitGeneration: record.splitGeneration,
            fromLaneIndex: record.laneIndex,
            checkpoint: record.checkpoint,
            witnesses,
            createdAt: now.toISOString(),
          });
          const certificateVerification = await verifyMicroRoomOverflowCertificate(certificate, {
            baseGridRoomId,
            expectedCheckpoint: record.checkpoint,
            now,
          });
          if (!certificateVerification.ok) throw new Error(certificateVerification.reason);
          scope.certificates.set(record.splitGeneration, certificateVerification.certificate);
        })();
        scope.certificateFormation.set(record.splitGeneration, formation);
        void formation.finally(() => {
          if (scope.certificateFormation.get(record.splitGeneration) === formation) {
            scope.certificateFormation.delete(record.splitGeneration);
          }
        }).catch(() => undefined);
      }
      await formation;
    }
    scope.touchedAt = now.getTime();
    return {
      record,
      laneWitnessCount: lane.size,
      certificates: this.listFrom(record.controlScopeId, record.splitGeneration),
    };
  }

  async publishCertificates(
    baseGridRoomId: string,
    values: unknown[],
    now = new Date(),
  ): Promise<MicroRoomOverflowCertificate[]> {
    for (const value of values.slice(0, 20)) {
      if (!value || typeof value !== 'object') continue;
      const candidate = value as Partial<MicroRoomOverflowCertificate>;
      if (!candidate.checkpoint) continue;
      const verification = await verifyMicroRoomOverflowCertificate(candidate, {
        baseGridRoomId,
        expectedCheckpoint: candidate.checkpoint,
        now,
      });
      if (!verification.ok) continue;
      const record = verification.certificate;
      const scope = this.getOrCreateScope(record.controlScopeId, now.getTime());
      if (!scope.certificates.has(record.fromSplitGeneration)) {
        scope.certificates.set(record.fromSplitGeneration, record);
      }
      scope.touchedAt = now.getTime();
    }
    return this.listByBaseGrid(baseGridRoomId);
  }

  list(controlScopeId: string): MicroRoomOverflowCertificate[] {
    const scope = this.scopes.get(controlScopeId);
    if (!scope) return [];
    return [...scope.certificates.values()]
      .sort((left, right) => left.fromSplitGeneration - right.fromSplitGeneration)
      .slice(0, 20);
  }

  listFrom(controlScopeId: string, fromSplitGeneration: number): MicroRoomOverflowCertificate[] {
    return this.list(controlScopeId).filter((certificate) =>
      certificate.fromSplitGeneration >= fromSplitGeneration);
  }

  listByBaseGrid(baseGridRoomId: string): MicroRoomOverflowCertificate[] {
    return this.list(microRoomControlScopeId(baseGridRoomId));
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
      lanePresence: new Map(),
      certificates: new Map(),
      certificateFormation: new Map(),
    };
    this.scopes.set(controlScopeId, scope);
    return scope;
  }

  private pruneScope(scope: ScopeState, now: Date): void {
    for (const [laneKey, lane] of scope.lanePresence) {
      for (const [pub, record] of lane) {
        if (Date.parse(record.expiresAt) <= now.getTime()) lane.delete(pub);
      }
      if (lane.size === 0) scope.lanePresence.delete(laneKey);
    }
  }

  private retainBoundedLaneCount(scope: ScopeState): void {
    if (scope.lanePresence.size < MAX_LANES_PER_SCOPE) return;
    const stalest = [...scope.lanePresence.entries()]
      .sort((left, right) => {
        const leftNewest = Math.max(...[...left[1].values()].map((record) => Date.parse(record.observedAt)));
        const rightNewest = Math.max(...[...right[1].values()].map((record) => Date.parse(record.observedAt)));
        return leftNewest - rightNewest;
      })[0];
    if (stalest) scope.lanePresence.delete(stalest[0]);
  }
}
