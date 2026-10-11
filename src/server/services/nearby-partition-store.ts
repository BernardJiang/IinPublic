import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyPartitionCoalesce,
  createNearbyPartitionSplit,
  NEARBY_PARTITION_MAX_DEPTH,
  NEARBY_PARTITION_MAX_CHAIN,
  NEARBY_PARTITION_MERGE_DWELL_MS,
  nearbyPartitionRootGroup,
  parseNearbyPartitionTransition,
  verifyNearbyPartitionTransition,
  type NearbyPartitionGroup,
  type NearbyPartitionTransition,
  type VerifiedNearbyPartitionTransition,
} from '../../shared/nearby-partition';
import {
  parseNearbyControlPresence,
  verifyNearbyControlPresence,
  type NearbyControlPresence,
} from '../../shared/nearby-control-presence';

const MAX_PARTITION_STATES = 16;
const MAX_ACTIVE_GROUPS = 8_192;
const MAX_TRANSITIONS_PER_STATE = 16_384;

type MergeWindow = {
  fingerprint: string;
  startedAtMs: number;
  startWitnesses: NearbyControlPresence[];
};

type PartitionState = {
  checkpoint: RoomProtocolCheckpoint;
  root: NearbyPartitionGroup;
  touchedAt: number;
  activeByPath: Map<string, NearbyPartitionGroup>;
  activeByRoom: Map<string, NearbyPartitionGroup>;
  presenceByRoom: Map<string, Map<string, NearbyControlPresence>>;
  transitionByFromRoom: Map<string, VerifiedNearbyPartitionTransition>;
  transitionsById: Map<string, VerifiedNearbyPartitionTransition>;
  originRoomsByTargetRoom: Map<string, string[]>;
  mergeWindows: Map<string, MergeWindow>;
};

export type NearbyPartitionRegistration = {
  record: NearbyControlPresence;
  roomWitnessCount: number;
  transitions: NearbyPartitionTransition[];
};

function checkpointKey(checkpoint: RoomProtocolCheckpoint): string {
  return [
    checkpoint.networkId,
    checkpoint.protocolEpoch,
    checkpoint.manifestSequence,
    checkpoint.manifestHash,
    checkpoint.chatroomCapacity,
  ].join(':');
}

function assertCheckpoint(checkpoint: RoomProtocolCheckpoint): void {
  if (!checkpoint
    || typeof checkpoint.networkId !== 'string'
    || checkpoint.networkId.length < 1
    || checkpoint.networkId.length > 128
    || !Number.isSafeInteger(checkpoint.protocolEpoch)
    || checkpoint.protocolEpoch < 1
    || !Number.isSafeInteger(checkpoint.manifestSequence)
    || checkpoint.manifestSequence < 1
    || !/^[a-f0-9]{64}$/.test(checkpoint.manifestHash)
    || !Number.isSafeInteger(checkpoint.chatroomCapacity)
    || checkpoint.chatroomCapacity < 1
    || checkpoint.chatroomCapacity > 4_096) {
    throw new Error('Nearby partition checkpoint is invalid');
  }
}

function parentPath(path: string): string | null {
  return path.length > 0 ? path.slice(0, -1) : null;
}

function siblingPaths(parent: string): string[] {
  return ['0', '1', '2', '3'].map((quadrant) => `${parent}${quadrant}`);
}

/**
 * Bounded rendezvous index for the flat adaptive partition DAG. The relay does not decide a
 * client's room: it stores signed member evidence and deterministic, independently verifiable
 * replacement transitions. Clients cache and verify the lineage for their own point.
 */
export class NearbyPartitionStore {
  private readonly states = new Map<string, PartitionState>();
  private readonly registrationTails = new Map<string, Promise<void>>();

  clear(): void {
    this.states.clear();
    this.registrationTails.clear();
  }

  transitionFor(checkpoint: RoomProtocolCheckpoint, roomId: string): NearbyPartitionTransition[] {
    const state = this.states.get(checkpointKey(checkpoint));
    if (!state) return [];
    const direct = state.transitionByFromRoom.get(roomId);
    if (direct) return [direct];
    if (state.activeByRoom.has(roomId)) return [];
    const origins = state.originRoomsByTargetRoom.get(roomId) ?? [];
    const transitions = origins
      .map((origin) => state.transitionByFromRoom.get(origin))
      .filter((candidate): candidate is VerifiedNearbyPartitionTransition => !!candidate);
    return [...new Map(transitions.map((transition) => [transition.transitionId, transition])).values()];
  }

  async publishTransitions(
    checkpoint: RoomProtocolCheckpoint,
    values: unknown[],
  ): Promise<NearbyPartitionTransition[]> {
    const state = this.getOrCreateState(checkpoint, Date.now());
    const accepted: NearbyPartitionTransition[] = [];
    for (const value of values.slice(0, NEARBY_PARTITION_MAX_CHAIN)) {
      const parsed = parseNearbyPartitionTransition(value);
      if (!parsed || state.transitionsById.has(parsed.transitionId)
        || state.transitionsById.size >= MAX_TRANSITIONS_PER_STATE) continue;
      const verification = await verifyNearbyPartitionTransition(parsed, checkpoint);
      if (!verification.ok) continue;
      this.recordTransition(state, verification.transition);
      accepted.push(verification.transition);
    }
    this.rebuildActiveGroups(state);
    return accepted;
  }

  async register(value: unknown, now = new Date()): Promise<NearbyPartitionRegistration> {
    const parsed = parseNearbyControlPresence(value);
    if (!parsed) throw new Error('malformed Nearby partition presence');
    const verification = await verifyNearbyControlPresence(parsed, {
      expectedCheckpoint: parsed.checkpoint,
      at: now,
    });
    if (!verification.ok) throw new Error(verification.reason);
    const record = verification.record;
    const lockKey = `${checkpointKey(record.checkpoint)}:${record.roomId}`;
    const previous = this.registrationTails.get(lockKey) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(() => this.registerSerialized(record, now));
    const tail = result.then(() => undefined, () => undefined);
    this.registrationTails.set(lockKey, tail);
    try {
      return await result;
    } finally {
      if (this.registrationTails.get(lockKey) === tail) this.registrationTails.delete(lockKey);
    }
  }

  private async registerSerialized(
    record: NearbyControlPresence,
    now: Date,
  ): Promise<NearbyPartitionRegistration> {
    const state = this.getOrCreateState(record.checkpoint, now.getTime());
    if (record.rootRoomId !== state.root.roomId) {
      throw new Error('Nearby partition presence has the wrong world root');
    }

    this.prune(state, now.getTime());
    const replacements = this.transitionFor(record.checkpoint, record.roomId);
    if (replacements.length > 0) {
      state.touchedAt = now.getTime();
      return { record, roomWitnessCount: 0, transitions: replacements };
    }
    const active = state.activeByRoom.get(record.roomId);
    if (!active) {
      throw new Error('Nearby partition presence targets an inactive group');
    }

    let room = state.presenceByRoom.get(record.roomId);
    if (!room) {
      room = new Map();
      state.presenceByRoom.set(record.roomId, room);
    }
    const capacity = record.checkpoint.chatroomCapacity;
    const wasPresent = room.has(record.pub);
    if (!wasPresent
      && active.path.length >= NEARBY_PARTITION_MAX_DEPTH
      && room.size >= capacity) {
      throw new Error('Nearby group is full and cannot be subdivided safely');
    }
    room.set(record.pub, record);
    const retained = [...room.values()]
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)
        || left.pub.localeCompare(right.pub))
      .slice(0, capacity + 1);
    room = new Map(retained.map((candidate) => [candidate.pub, candidate]));
    state.presenceByRoom.set(record.roomId, room);

    let transitions: NearbyPartitionTransition[] = [];
    if (room.size === capacity + 1 && active.path.length < NEARBY_PARTITION_MAX_DEPTH) {
      const candidate = createNearbyPartitionSplit({
        checkpoint: state.checkpoint,
        fromGroup: active,
        witnesses: [...room.values()],
        createdAt: now.toISOString(),
      });
      const checked = await verifyNearbyPartitionTransition(candidate, state.checkpoint);
      if (!checked.ok) throw new Error(checked.reason);
      if (state.transitionsById.size >= MAX_TRANSITIONS_PER_STATE) {
        throw new Error('Nearby partition index reached its bounded group limit');
      }
      this.recordTransition(state, checked.transition);
      this.rebuildActiveGroups(state);
      transitions = this.transitionFor(state.checkpoint, active.roomId);
      if (transitions.length === 0) {
        if (!wasPresent) room.delete(record.pub);
        throw new Error('Nearby partition index reached its bounded group limit');
      }
    } else {
      const coalesced = await this.maybeCoalesce(state, active.path, now);
      if (coalesced) transitions = [coalesced];
    }
    state.touchedAt = now.getTime();
    return { record, roomWitnessCount: room.size, transitions };
  }

  private async maybeCoalesce(
    state: PartitionState,
    path: string,
    now: Date,
  ): Promise<VerifiedNearbyPartitionTransition | null> {
    const parent = parentPath(path);
    if (parent == null) return null;
    const groups = siblingPaths(parent).map((sibling) => state.activeByPath.get(sibling));
    if (groups.some((group) => !group)) {
      state.mergeWindows.delete(parent);
      return null;
    }
    const siblings = groups as NearbyPartitionGroup[];
    const witnesses = siblings.flatMap((group) => [
      ...(state.presenceByRoom.get(group.roomId)?.values() ?? []),
    ]).sort((left, right) => left.pub.localeCompare(right.pub));
    const pubs = new Set(witnesses.map((witness) => witness.pub));
    if (witnesses.length < 1
      || pubs.size !== witnesses.length
      || witnesses.length > state.checkpoint.chatroomCapacity) {
      state.mergeWindows.delete(parent);
      return null;
    }
    const fingerprint = witnesses.map((witness) => `${witness.pub}:${witness.roomId}`).join('|');
    const existing = state.mergeWindows.get(parent);
    if (!existing || existing.fingerprint !== fingerprint) {
      state.mergeWindows.set(parent, {
        fingerprint,
        startedAtMs: now.getTime(),
        startWitnesses: witnesses,
      });
      return null;
    }
    if (now.getTime() - existing.startedAtMs < NEARBY_PARTITION_MERGE_DWELL_MS) return null;
    const candidate = createNearbyPartitionCoalesce({
      checkpoint: state.checkpoint,
      fromGroups: siblings,
      startWitnesses: existing.startWitnesses,
      endWitnesses: witnesses,
      dwellStartedAt: new Date(existing.startedAtMs).toISOString(),
      dwellEndedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });
    const verification = await verifyNearbyPartitionTransition(candidate, state.checkpoint);
    if (!verification.ok) throw new Error(verification.reason);
    if (state.transitionsById.size >= MAX_TRANSITIONS_PER_STATE) return null;
    this.recordTransition(state, verification.transition);
    this.rebuildActiveGroups(state);
    if (state.transitionByFromRoom.get(siblings[0]!.roomId)?.transitionId
      !== verification.transition.transitionId) return null;
    state.mergeWindows.delete(parent);
    return verification.transition;
  }

  private getOrCreateState(checkpoint: RoomProtocolCheckpoint, nowMs: number): PartitionState {
    assertCheckpoint(checkpoint);
    const key = checkpointKey(checkpoint);
    let state = this.states.get(key);
    if (state) return state;
    if (this.states.size >= MAX_PARTITION_STATES) {
      const oldest = [...this.states.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
      if (oldest) this.states.delete(oldest[0]);
    }
    const root = nearbyPartitionRootGroup(checkpoint);
    state = {
      checkpoint: { ...checkpoint },
      root,
      touchedAt: nowMs,
      activeByPath: new Map([[root.path, root]]),
      activeByRoom: new Map([[root.roomId, root]]),
      presenceByRoom: new Map(),
      transitionByFromRoom: new Map(),
      transitionsById: new Map(),
      originRoomsByTargetRoom: new Map(),
      mergeWindows: new Map(),
    };
    this.states.set(key, state);
    return state;
  }

  private transitionPriority(
    left: VerifiedNearbyPartitionTransition,
    right: VerifiedNearbyPartitionTransition,
  ): number {
    return Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.transitionId.localeCompare(right.transitionId);
  }

  private recordTransition(
    state: PartitionState,
    transition: VerifiedNearbyPartitionTransition,
  ): void {
    state.transitionsById.set(transition.transitionId, transition);
    for (const target of transition.toGroups) {
      state.originRoomsByTargetRoom.set(
        target.roomId,
        transition.fromGroups.map((group) => group.roomId),
      );
    }
  }

  /** Rebuild the active flat cut from the immutable DAG so partition-order conflicts converge. */
  private rebuildActiveGroups(state: PartitionState): void {
    const canonicalByFromRoom = new Map<string, VerifiedNearbyPartitionTransition>();
    const transitions = [...state.transitionsById.values()].sort((left, right) =>
      this.transitionPriority(left, right));
    for (const transition of transitions) {
      for (const from of transition.fromGroups) {
        if (!canonicalByFromRoom.has(from.roomId)) {
          canonicalByFromRoom.set(from.roomId, transition);
        }
      }
    }

    const activeByPath = new Map<string, NearbyPartitionGroup>([[state.root.path, state.root]]);
    const activeByRoom = new Map<string, NearbyPartitionGroup>([[state.root.roomId, state.root]]);
    const transitionByFromRoom = new Map<string, VerifiedNearbyPartitionTransition>();
    for (let pass = 0; pass < NEARBY_PARTITION_MAX_CHAIN; pass += 1) {
      let changed = false;
      for (const transition of transitions) {
        if (transition.fromGroups.some((group) =>
          canonicalByFromRoom.get(group.roomId)?.transitionId !== transition.transitionId)) continue;
        if (transition.fromGroups.some((group) =>
          activeByPath.get(group.path)?.roomId !== group.roomId)) continue;
        const nextSize = activeByPath.size - transition.fromGroups.length + transition.toGroups.length;
        if (nextSize > MAX_ACTIVE_GROUPS) continue;
        for (const group of transition.fromGroups) {
          activeByPath.delete(group.path);
          activeByRoom.delete(group.roomId);
          transitionByFromRoom.set(group.roomId, transition);
        }
        for (const group of transition.toGroups) {
          activeByPath.set(group.path, group);
          activeByRoom.set(group.roomId, group);
        }
        changed = true;
      }
      if (!changed) break;
    }
    state.activeByPath = activeByPath;
    state.activeByRoom = activeByRoom;
    state.transitionByFromRoom = transitionByFromRoom;
    for (const roomId of state.presenceByRoom.keys()) {
      if (!activeByRoom.has(roomId)) state.presenceByRoom.delete(roomId);
    }
    for (const parent of state.mergeWindows.keys()) {
      if (siblingPaths(parent).some((path) => !activeByPath.has(path))) {
        state.mergeWindows.delete(parent);
      }
    }
  }

  private prune(state: PartitionState, nowMs: number): void {
    for (const [roomId, room] of state.presenceByRoom) {
      for (const [pub, presence] of room) {
        if (Date.parse(presence.expiresAt) <= nowMs) room.delete(pub);
      }
      if (room.size === 0) state.presenceByRoom.delete(roomId);
    }
  }
}
