import { portableSha256Hex } from './portable-sha256';

export const ACTIVE_EXCHANGE_ROOM_STORAGE_KEY = 'iinpublic_active_exchange_room_v1';
export const ROOM_RENDEZVOUS_TOKEN_EPOCH_MS = 15 * 60_000;
export const DEFAULT_ROOM_NEIGHBOR_LIMIT = 12;
export const MIN_ROOM_NEIGHBOR_LIMIT = 8;
export const MAX_ROOM_NEIGHBOR_LIMIT = 16;

export type RoomProtocolCheckpoint = {
  networkId: string;
  protocolEpoch: number;
  manifestSequence: number;
  manifestHash: string;
  chatroomCapacity: number;
};

export type ActiveRoomScope = {
  roomId: string;
  roomToken: string;
  tokenExpiresAt: string;
  networkId: string;
  protocolEpoch: number;
  manifestSequence: number;
  manifestHash: string;
};

export type ActiveExchangeRoom = RoomProtocolCheckpoint & {
  version: 1;
  roomId: string;
  enteredAt: string;
  transitionId: string;
  neighborLimit: number;
  exchangeState: 'starting' | 'active' | 'paused' | 'disconnected';
  lastError?: string;
};

export type ActiveExchangeRoomSnapshot = {
  version: 1;
  active: ActiveExchangeRoom | null;
  rememberedRoomIds: string[];
  transition: null | {
    id: string;
    fromRoomId?: string;
    toRoomId?: string;
    phase: 'stopping-old' | 'starting-new' | 'leaving';
    startedAt: string;
  };
};

type ActiveRoomStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type ActiveExchangeRoomHooks = {
  stopRoom: (room: ActiveExchangeRoom) => Promise<void> | void;
  startRoom: (room: ActiveExchangeRoom) => Promise<void> | void;
};

export type ActivateRoomInput = RoomProtocolCheckpoint & {
  roomId: string;
  neighborLimit?: number;
};

const EMPTY_SNAPSHOT: ActiveExchangeRoomSnapshot = {
  version: 1,
  active: null,
  rememberedRoomIds: [],
  transition: null,
};

export const BASELINE_ROOM_PROTOCOL_CHECKPOINT: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-production',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: portableSha256Hex('iinpublic:protocol-manifest:genesis:v1:capacity=498'),
  chatroomCapacity: 498,
};

export function deriveRoomRendezvousToken(
  checkpoint: Pick<RoomProtocolCheckpoint, 'networkId' | 'protocolEpoch'>,
  roomId: string,
  nowMs = Date.now(),
): { token: string; expiresAt: string } {
  const epoch = Math.floor(nowMs / ROOM_RENDEZVOUS_TOKEN_EPOCH_MS);
  const token = portableSha256Hex([
    'iinpublic:room-rendezvous:v1',
    checkpoint.networkId,
    checkpoint.protocolEpoch,
    roomId,
    epoch,
  ].join(':')).slice(0, 32);
  return {
    token,
    expiresAt: new Date((epoch + 1) * ROOM_RENDEZVOUS_TOKEN_EPOCH_MS).toISOString(),
  };
}

export function activeRoomScope(room: ActiveExchangeRoom, nowMs = Date.now()): ActiveRoomScope {
  const rendezvous = deriveRoomRendezvousToken(room, room.roomId, nowMs);
  return {
    roomId: room.roomId,
    roomToken: rendezvous.token,
    tokenExpiresAt: rendezvous.expiresAt,
    networkId: room.networkId,
    protocolEpoch: room.protocolEpoch,
    manifestSequence: room.manifestSequence,
    manifestHash: room.manifestHash,
  };
}

export function roomScopeMatches(
  expected: ActiveRoomScope,
  candidate: ActiveRoomScope | null | undefined,
  now = new Date(),
): boolean {
  if (!candidate || Date.parse(candidate.tokenExpiresAt) <= now.getTime()) return false;
  return candidate.roomId === expected.roomId
    && candidate.roomToken === expected.roomToken
    && candidate.networkId === expected.networkId
    && candidate.protocolEpoch === expected.protocolEpoch
    && candidate.manifestSequence === expected.manifestSequence
    && candidate.manifestHash === expected.manifestHash;
}

/**
 * Mailbox delivery has no live mesh session to supply a room boundary. Bind it to the currently
 * active room and require a valid sender timestamp, but never compare wall clocks across phones:
 * device clock skew must not reject a legitimate same-room Talk.
 */
export function roomDeliveryMatchesActiveRoom(
  delivery: { roomId?: unknown; broadcastAt?: unknown },
  active: ActiveExchangeRoom | null | undefined,
  currentRoomId: string | null | undefined,
): boolean {
  if (!active || active.exchangeState !== 'active' || !currentRoomId) return false;
  if (delivery.roomId !== currentRoomId || delivery.roomId !== active.roomId) return false;
  if (typeof delivery.broadcastAt !== 'string') return false;
  return Number.isFinite(Date.parse(delivery.broadcastAt));
}

export class ActiveExchangeRoomController {
  private snapshot: ActiveExchangeRoomSnapshot;
  private operation: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: ActiveRoomStorage,
    private readonly hooks: ActiveExchangeRoomHooks,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.snapshot = readSnapshot(storage);
    // A process may die mid-switch. The old room was already stopped before a new room could be
    // started, so never silently resurrect it. Keep the intended room visibly disconnected and
    // require resume() or a fresh activate() to restart exchange idempotently.
    if (this.snapshot.transition) {
      this.snapshot = {
        ...this.snapshot,
        active: this.snapshot.active
          ? { ...this.snapshot.active, exchangeState: 'disconnected', lastError: 'interrupted room transition' }
          : null,
        transition: null,
      };
      this.persist();
    } else if (this.snapshot.active?.exchangeState === 'active') {
      // Persistence proves the selected audience, not that process-owned sockets/radios survived.
      // A fresh runtime must explicitly resume before publishing presence again.
      this.snapshot = {
        ...this.snapshot,
        active: { ...this.snapshot.active, exchangeState: 'disconnected' },
      };
      this.persist();
    }
  }

  getSnapshot(): ActiveExchangeRoomSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  getActiveRoom(): ActiveExchangeRoom | null {
    return this.snapshot.active ? { ...this.snapshot.active } : null;
  }

  /**
   * Scope of the room being exchanged in. Also returned while 'starting': the startRoom hook is
   * what builds that room's presence and nearby discovery, and needs its scope to do so.
   * Accepting inbound traffic still requires 'active' (roomDeliveryMatchesActiveRoom).
   */
  getScope(now = this.now()): ActiveRoomScope | null {
    const active = this.snapshot.active;
    if (!active || (active.exchangeState !== 'active' && active.exchangeState !== 'starting')) return null;
    return activeRoomScope(active, now.getTime());
  }

  activate(input: ActivateRoomInput): Promise<ActiveExchangeRoom> {
    return this.transitionTo(input);
  }

  /**
   * Move durable room membership between stopping the old exchange stack and starting the new
   * one. This is the only safe ordering for an application-level room switch: no old discovery
   * remains live while the membership moves, and no new discovery starts before the join lands.
   */
  transitionTo(
    input: ActivateRoomInput,
    moveMembership?: () => Promise<void>,
  ): Promise<ActiveExchangeRoom> {
    return this.enqueue(async () => {
      const normalized = normalizeActivateInput(input);
      const current = this.snapshot.active;
      if (current?.roomId === normalized.roomId
        && sameCheckpoint(current, normalized)
        && current.exchangeState === 'active') return { ...current };

      const transitionId = randomTransitionId();
      if (current) {
        this.snapshot.transition = {
          id: transitionId,
          fromRoomId: current.roomId,
          toRoomId: normalized.roomId,
          phase: 'stopping-old',
          startedAt: this.now().toISOString(),
        };
        this.persist();
        await this.hooks.stopRoom({ ...current });
      }

      const next: ActiveExchangeRoom = {
        version: 1,
        ...normalized,
        // A protocol checkpoint/epoch transition does not make an existing participant a new
        // entrant. Preserve FIFO position when the physical room ID is unchanged.
        enteredAt: current?.roomId === normalized.roomId ? current.enteredAt : this.now().toISOString(),
        transitionId,
        exchangeState: 'starting',
      };
      this.snapshot.active = next;
      this.snapshot.rememberedRoomIds = uniqueRoomIds([...this.snapshot.rememberedRoomIds, next.roomId]);
      this.snapshot.transition = {
        id: transitionId,
        ...(current ? { fromRoomId: current.roomId } : {}),
        toRoomId: next.roomId,
        phase: 'starting-new',
        startedAt: this.now().toISOString(),
      };
      this.persist();
      try {
        if (moveMembership) await moveMembership();
        await this.hooks.startRoom({ ...next });
        this.snapshot.active = { ...next, exchangeState: 'active' };
        this.snapshot.transition = null;
        this.persist();
        return { ...this.snapshot.active };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.snapshot.active = { ...next, exchangeState: 'disconnected', lastError: reason };
        this.snapshot.transition = null;
        this.persist();
        throw error;
      }
    });
  }

  pause(): Promise<void> {
    return this.enqueue(async () => {
      const active = this.snapshot.active;
      if (!active || active.exchangeState === 'paused') return;
      await this.hooks.stopRoom({ ...active });
      this.snapshot.active = { ...active, exchangeState: 'paused' };
      this.snapshot.transition = null;
      this.persist();
    });
  }

  resume(): Promise<ActiveExchangeRoom | null> {
    return this.enqueue<ActiveExchangeRoom | null>(async () => {
      const active = this.snapshot.active;
      if (!active) return null;
      if (active.exchangeState === 'active') return { ...active };
      const { lastError: _lastError, ...activeWithoutError } = active;
      const starting: ActiveExchangeRoom = { ...activeWithoutError, exchangeState: 'starting' };
      this.snapshot.active = starting;
      this.persist();
      try {
        await this.hooks.startRoom({ ...starting });
        this.snapshot.active = { ...starting, exchangeState: 'active' };
        this.persist();
        return { ...this.snapshot.active };
      } catch (error) {
        this.snapshot.active = {
          ...starting,
          exchangeState: 'disconnected',
          lastError: error instanceof Error ? error.message : String(error),
        };
        this.persist();
        throw error;
      }
    });
  }

  leave(): Promise<void> {
    return this.enqueue(async () => {
      const active = this.snapshot.active;
      if (!active) return;
      this.snapshot.transition = {
        id: randomTransitionId(),
        fromRoomId: active.roomId,
        phase: 'leaving',
        startedAt: this.now().toISOString(),
      };
      this.persist();
      await this.hooks.stopRoom({ ...active });
      this.snapshot.active = null;
      this.snapshot.transition = null;
      this.persist();
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operation.then(operation, operation);
    this.operation = run.catch(() => undefined);
    return run;
  }

  private persist(): void {
    this.storage.setItem(ACTIVE_EXCHANGE_ROOM_STORAGE_KEY, JSON.stringify(this.snapshot));
  }
}

function normalizeActivateInput(input: ActivateRoomInput): ActivateRoomInput & { neighborLimit: number } {
  const roomId = String(input.roomId || '').trim();
  const networkId = String(input.networkId || '').trim();
  if (!roomId || roomId.length > 256) throw new Error('active room id is invalid');
  if (!networkId || networkId.length > 128) throw new Error('room network id is invalid');
  if (!Number.isSafeInteger(input.protocolEpoch) || input.protocolEpoch < 1) throw new Error('protocol epoch is invalid');
  if (!Number.isSafeInteger(input.manifestSequence) || input.manifestSequence < 1) throw new Error('manifest sequence is invalid');
  if (!/^[a-f0-9]{64}$/.test(input.manifestHash)) throw new Error('manifest hash is invalid');
  if (!Number.isSafeInteger(input.chatroomCapacity) || input.chatroomCapacity < 1 || input.chatroomCapacity > 1_000_000) {
    throw new Error('chatroom capacity is invalid');
  }
  const neighborLimit = input.neighborLimit ?? DEFAULT_ROOM_NEIGHBOR_LIMIT;
  if (!Number.isSafeInteger(neighborLimit) || neighborLimit < MIN_ROOM_NEIGHBOR_LIMIT || neighborLimit > MAX_ROOM_NEIGHBOR_LIMIT) {
    throw new Error(`neighbor limit must be between ${MIN_ROOM_NEIGHBOR_LIMIT} and ${MAX_ROOM_NEIGHBOR_LIMIT}`);
  }
  return { ...input, roomId, networkId, neighborLimit };
}

function sameCheckpoint(a: RoomProtocolCheckpoint, b: RoomProtocolCheckpoint): boolean {
  return a.networkId === b.networkId
    && a.protocolEpoch === b.protocolEpoch
    && a.manifestSequence === b.manifestSequence
    && a.manifestHash === b.manifestHash
    && a.chatroomCapacity === b.chatroomCapacity;
}

function readSnapshot(storage: ActiveRoomStorage): ActiveExchangeRoomSnapshot {
  try {
    const raw = storage.getItem(ACTIVE_EXCHANGE_ROOM_STORAGE_KEY);
    if (!raw) return cloneSnapshot(EMPTY_SNAPSHOT);
    const parsed = JSON.parse(raw) as Partial<ActiveExchangeRoomSnapshot>;
    if (parsed.version !== 1 || !Array.isArray(parsed.rememberedRoomIds)) return cloneSnapshot(EMPTY_SNAPSHOT);
    const active = parsed.active === null ? null : parseActiveRoom(parsed.active);
    if (parsed.active !== null && !active) return cloneSnapshot(EMPTY_SNAPSHOT);
    return {
      version: 1,
      active,
      rememberedRoomIds: uniqueRoomIds(parsed.rememberedRoomIds),
      transition: parseTransition(parsed.transition),
    };
  } catch {
    storage.removeItem(ACTIVE_EXCHANGE_ROOM_STORAGE_KEY);
    return cloneSnapshot(EMPTY_SNAPSHOT);
  }
}

function parseActiveRoom(value: unknown): ActiveExchangeRoom | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as ActiveExchangeRoom;
  try {
    const normalized = normalizeActivateInput(candidate);
    if (candidate.version !== 1 || !Number.isFinite(Date.parse(candidate.enteredAt)) || !candidate.transitionId) return null;
    if (!['starting', 'active', 'paused', 'disconnected'].includes(candidate.exchangeState)) return null;
    return { ...candidate, ...normalized };
  } catch {
    return null;
  }
}

function parseTransition(value: unknown): ActiveExchangeRoomSnapshot['transition'] {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as NonNullable<ActiveExchangeRoomSnapshot['transition']>;
  if (!candidate.id || !['stopping-old', 'starting-new', 'leaving'].includes(candidate.phase)) return null;
  if (!Number.isFinite(Date.parse(candidate.startedAt))) return null;
  return { ...candidate };
}

function uniqueRoomIds(values: readonly unknown[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter((value) => value && value.length <= 256))].slice(-128);
}

function randomTransitionId(): string {
  const uuid = typeof crypto !== 'undefined' ? crypto.randomUUID?.() : undefined;
  return `room_${uuid || `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`}`;
}

function cloneSnapshot(snapshot: ActiveExchangeRoomSnapshot): ActiveExchangeRoomSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as ActiveExchangeRoomSnapshot;
}
