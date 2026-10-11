import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import {
  createNearbyManualCohortSelection,
  createNearbyPartitionTransitionV2,
  nearbyCohortRootGroup,
  type NearbyPartitionGroupV2,
} from '../../shared/nearby-cohort-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import {
  NEARBY_COHORT_RECENT_LIMIT,
  NEARBY_COHORT_SUMMARY_LIMIT,
  NearbyCohortTraversalClient,
  NearbyCohortTraversalError,
  type NearbyCohortHandoff,
  type NearbyCohortReservation,
  type NearbyCohortSummary,
  type NearbyCohortTraversalApi,
  type NearbyCohortTraversalContext,
} from '../../web/services/nearby-cohort-traversal-client';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const checkpoint: RoomProtocolCheckpoint = {
  networkId: 'iinpublic-test',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: 'a'.repeat(64),
  chatroomCapacity: 2,
};
const now = new Date('2026-10-10T20:00:10.000Z');

function cohortGroups(): NearbyPartitionGroupV2[] {
  const root = nearbyCohortRootGroup(checkpoint);
  const first = createNearbyPartitionTransitionV2({
    axis: 'cohort',
    checkpoint,
    fromGroup: root,
    evidenceHash: '1'.repeat(64),
    createdAt: '2026-10-10T20:00:00.000Z',
  });
  return first.toGroups.flatMap((parent, index) => createNearbyPartitionTransitionV2({
    axis: 'cohort',
    checkpoint,
    fromGroup: parent,
    evidenceHash: String(index + 2).repeat(64),
    createdAt: `2026-10-10T20:00:0${index + 1}.000Z`,
  }).toGroups);
}

function summaries(groups: NearbyPartitionGroupV2[], current: NearbyPartitionGroupV2): NearbyCohortSummary[] {
  return groups.map((group) => ({
    group,
    activeCount: 1,
    reservedCount: 0,
    available: true,
    isCurrent: group.roomId === current.roomId,
  }));
}

class FakeApi implements NearbyCohortTraversalApi {
  readonly reserveAttempts: string[] = [];
  readonly observedLimits: number[] = [];
  activeGroup: NearbyPartitionGroupV2 | null = null;
  fullRoomIds = new Set<string>();
  offline = false;
  rows: NearbyCohortSummary[] = [];

  async summaries(input: Parameters<NearbyCohortTraversalApi['summaries']>[0]) {
    this.observedLimits.push(input.limit);
    if (this.offline) throw new NearbyCohortTraversalError('offline', 'network offline');
    return { cohorts: this.rows.slice(0, input.limit), truncated: this.rows.length > input.limit };
  }

  async active() {
    if (this.offline) throw new NearbyCohortTraversalError('offline', 'network offline');
    return { activeGroup: this.activeGroup };
  }

  async reserve(input: Parameters<NearbyCohortTraversalApi['reserve']>[0]): Promise<NearbyCohortReservation> {
    this.reserveAttempts.push(input.targetGroup.roomId);
    if (this.fullRoomIds.has(input.targetGroup.roomId)) {
      throw new NearbyCohortTraversalError('full', 'target-full');
    }
    const selection = await createNearbyManualCohortSelection({
      checkpoint: input.context.checkpoint,
      rootRoomId: nearbyCohortRootGroup(input.context.checkpoint).roomId,
      userId: input.context.userId,
      pair: input.context.pair,
      privacyMode: input.context.privacyMode,
      fromGroup: input.fromGroup,
      targetGroup: input.targetGroup,
      visitOrdinal: input.visitOrdinal,
      now,
    });
    return {
      reservationToken: `token-${input.targetGroup.roomId}`,
      expiresAt: new Date(now.getTime() + 10_000).toISOString(),
      selection,
      targetGroup: input.targetGroup,
    };
  }

  async commit(input: Parameters<NearbyCohortTraversalApi['commit']>[0]) {
    this.activeGroup = input.reservation.targetGroup;
    return { activeGroup: input.reservation.targetGroup };
  }

  async cancel() {}
}

function handoff(log: string[]): NearbyCohortHandoff {
  return {
    stopOld: async (group) => { log.push(`stop:${group.roomId}`); },
    startTarget: async (group) => { log.push(`start:${group.roomId}`); },
    restoreOld: async (group) => { log.push(`restore:${group.roomId}`); },
  };
}

async function setup(storage = new MemoryStorage()) {
  const pair = await SEA.pair() as SeaSigningPair;
  const groups = cohortGroups();
  const context: NearbyCohortTraversalContext = {
    checkpoint,
    userId: 'alice',
    pair,
    privacyMode: 'regional',
    defaultGroup: groups[0]!,
  };
  const api = new FakeApi();
  api.activeGroup = context.defaultGroup;
  api.rows = summaries(groups, context.defaultGroup);
  const log: string[] = [];
  const client = new NearbyCohortTraversalClient({
    api,
    handoff: handoff(log),
    storage,
    now: () => now,
  });
  await client.initialize(context);
  return { api, client, context, groups, log, pair, storage };
}

describe('NearbyCohortTraversalClient', () => {
  it('keeps summaries bounded and exposes only an aggregate group count', async () => {
    const { api, client, context, groups } = await setup();
    api.rows = [
      ...summaries(groups, context.defaultGroup),
      ...Array.from({ length: 100 }, () => summaries(groups, context.defaultGroup)[1]!),
    ];
    await client.refreshSummaries();
    expect(api.observedLimits.at(-1)).toBe(NEARBY_COHORT_SUMMARY_LIMIT);
    expect(client.getSnapshot()).toMatchObject({ groupCount: 4, isDefaultGroup: true });
    expect(client.getSnapshot()).not.toHaveProperty('roomId');
  });

  it('reserves, stops old, commits, persists, and starts target in order', async () => {
    const { api, client, context, log } = await setup();
    const originalCommit = api.commit.bind(api);
    api.commit = async (input) => {
      log.push(`commit:${input.reservation.targetGroup.roomId}`);
      return originalCommit(input);
    };
    await client.meetAnotherGroup();
    const active = client.getActiveGroup()!;
    expect(active.roomId).not.toBe(context.defaultGroup.roomId);
    expect(log).toEqual([
      `stop:${context.defaultGroup.roomId}`,
      `commit:${active.roomId}`,
      `start:${active.roomId}`,
    ]);
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', isDefaultGroup: false });
  });

  it('retries another deterministic candidate when the first target is full', async () => {
    const first = await setup();
    const mirror = new NearbyCohortTraversalClient({
      api: first.api,
      handoff: handoff([]),
      storage: new MemoryStorage(),
      now: () => now,
    });
    await mirror.initialize(first.context);
    await mirror.meetAnotherGroup();
    const deterministicFirst = first.api.reserveAttempts.at(-1)!;

    first.api.activeGroup = first.context.defaultGroup;
    first.api.reserveAttempts.length = 0;
    first.api.fullRoomIds.add(deterministicFirst);
    const retry = new NearbyCohortTraversalClient({
      api: first.api,
      handoff: handoff([]),
      storage: new MemoryStorage(),
      now: () => now,
    });
    await retry.initialize(first.context);
    await retry.meetAnotherGroup();
    expect(first.api.reserveAttempts[0]).toBe(deterministicFirst);
    expect(first.api.reserveAttempts[1]).not.toBe(deterministicFirst);
    expect(retry.getSnapshot().status).toBe('ready');
  });

  it('avoids a recently visited group while an unvisited group is available', async () => {
    const { api, client } = await setup();
    await client.meetAnotherGroup();
    const firstVisit = client.getActiveGroup()!.roomId;
    api.reserveAttempts.length = 0;
    await client.meetAnotherGroup();
    expect(api.reserveAttempts[0]).not.toBe(firstVisit);
    expect(new Set(api.reserveAttempts).size).toBe(api.reserveAttempts.length);
  });

  it('returns to the stable default through the same atomic handoff', async () => {
    const { client, context } = await setup();
    await client.meetAnotherGroup();
    await client.returnToDefaultGroup();
    expect(client.getActiveGroup()).toEqual(context.defaultGroup);
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', isDefaultGroup: true });
  });

  it('retries target startup after commit without restoring the superseded old claim', async () => {
    const storage = new MemoryStorage();
    const pair = await SEA.pair() as SeaSigningPair;
    const groups = cohortGroups();
    const context: NearbyCohortTraversalContext = {
      checkpoint,
      userId: 'alice',
      pair,
      privacyMode: 'regional',
      defaultGroup: groups[0]!,
    };
    const api = new FakeApi();
    api.activeGroup = context.defaultGroup;
    api.rows = summaries(groups, context.defaultGroup);
    const log: string[] = [];
    let starts = 0;
    const client = new NearbyCohortTraversalClient({
      api,
      storage,
      now: () => now,
      handoff: {
        stopOld: async () => { log.push('stop'); },
        startTarget: async () => {
          starts += 1;
          log.push(`start-${starts}`);
          if (starts === 1) throw new Error('transient runtime startup failure');
        },
        restoreOld: async () => { log.push('restore-old'); },
      },
    });
    await client.initialize(context);
    await client.meetAnotherGroup();
    expect(log).toEqual(['stop', 'start-1', 'start-2']);
    expect(log).not.toContain('restore-old');
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', isDefaultGroup: false });
    expect(storage.length).toBe(1);
  });

  it('restores a server-confirmed committed visit before room startup', async () => {
    const first = await setup();
    await first.client.meetAnotherGroup();
    const visited = first.client.getActiveGroup()!;
    const restartLog: string[] = [];
    const restarted = new NearbyCohortTraversalClient({
      api: first.api,
      handoff: handoff(restartLog),
      storage: first.storage,
      now: () => new Date(now.getTime() + 1_000),
    });
    const bootGroup = await restarted.initialize(first.context);
    expect(bootGroup).toEqual(visited);
    expect(restarted.getSnapshot().isDefaultGroup).toBe(false);
    expect(restartLog).toEqual([]);
  });

  it('fails an expired or unverifiable persisted visit safely to default', async () => {
    const first = await setup();
    await first.client.meetAnotherGroup();
    const restarted = new NearbyCohortTraversalClient({
      api: first.api,
      handoff: handoff([]),
      storage: first.storage,
      now: () => new Date(now.getTime() + 181_000),
    });
    await expect(restarted.initialize(first.context)).resolves.toEqual(first.context.defaultGroup);
    expect(restarted.getSnapshot().isDefaultGroup).toBe(true);

    await first.client.meetAnotherGroup();
    first.api.offline = true;
    const offlineRestart = new NearbyCohortTraversalClient({
      api: first.api,
      handoff: handoff([]),
      storage: first.storage,
      now: () => new Date(now.getTime() + 1_000),
    });
    await expect(offlineRestart.initialize(first.context)).resolves.toEqual(first.context.defaultGroup);
    expect(offlineRestart.getSnapshot()).toMatchObject({ isDefaultGroup: true, status: 'offline' });
  });

  it('never stops the old group when every candidate is already full', async () => {
    const { api, client, context, groups, log } = await setup();
    api.rows = summaries(groups, context.defaultGroup).map((row) => ({
      ...row,
      available: row.isCurrent,
    }));
    await client.meetAnotherGroup();
    expect(client.getSnapshot().status).toBe('full');
    expect(client.getActiveGroup()).toEqual(context.defaultGroup);
    expect(log).toEqual([]);
  });

  it('serializes concurrent switch requests and retains one active group', async () => {
    const { api, client, context, log } = await setup();
    await Promise.all([client.meetAnotherGroup(), client.meetAnotherGroup()]);
    expect(client.getSnapshot()).toMatchObject({ status: 'ready', isDefaultGroup: false });
    expect(client.getActiveGroup()).not.toEqual(context.defaultGroup);
    expect(api.activeGroup).toEqual(client.getActiveGroup());
    expect(log.filter((entry) => entry.startsWith('stop:'))).toHaveLength(2);
    expect(log.filter((entry) => entry.startsWith('start:'))).toHaveLength(2);
  });

  it('bounds persisted recent history', async () => {
    const { client, storage } = await setup();
    for (let index = 0; index < NEARBY_COHORT_RECENT_LIMIT + 4; index += 1) {
      await client.meetAnotherGroup();
    }
    const saved = JSON.parse(storage.getItem(storage.key(0)!)!) as { recentRoomIds: string[] };
    expect(saved.recentRoomIds.length).toBeLessThanOrEqual(NEARBY_COHORT_RECENT_LIMIT);
  });
});
