import SEA from 'gun/sea';
import type { RoomProtocolCheckpoint } from '../../shared/active-exchange-room';
import { createNearbyCohortSeatClaim } from '../../shared/nearby-cohort-admission';
import {
  createNearbyPartitionTransitionV2,
  nearbyCohortRootGroup,
} from '../../shared/nearby-cohort-protocol';
import type { SeaSigningPair } from '../../shared/p2p-runtime';
import { NearbyCohortStore, NearbyCohortStoreError } from '../../server/services/nearby-cohort-store';
import { WebNearbyCohortTraversalApi } from '../../web/services/nearby-cohort-traversal-api';
import {
  NearbyCohortTraversalClient,
  type NearbyCohortHandoff,
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
  networkId: 'iinpublic-open40-integration',
  protocolEpoch: 1,
  manifestSequence: 1,
  manifestHash: '9'.repeat(64),
  chatroomCapacity: 2,
};
const now = new Date('2026-10-11T09:00:00.000Z');

function json(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function storeFetch(store: NearbyCohortStore): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    try {
      const summaryMatch = url.pathname.match(/^\/api\/nearby-cohorts\/([^/]+)\/summaries$/);
      if (summaryMatch && (!init?.method || init.method === 'GET')) {
        return json(await store.summaries({
          checkpoint,
          areaBindingId: decodeURIComponent(summaryMatch[1]!),
          currentRoomId: String(url.searchParams.get('currentRoomId') || ''),
          now,
        }));
      }
      const activeMatch = url.pathname.match(/^\/api\/nearby-cohorts\/active\/(.+)$/);
      if (activeMatch && (!init?.method || init.method === 'GET')) {
        return json({ claim: store.activeClaim(checkpoint, decodeURIComponent(activeMatch[1]!), now) });
      }
      if (url.pathname === '/api/nearby-cohorts/reservations' && init?.method === 'POST') {
        return json(await store.reserve({ claim: body.claim, selection: body.selection, now }), 201);
      }
      const commitMatch = url.pathname.match(/^\/api\/nearby-cohorts\/reservations\/([^/]+)\/commit$/);
      if (commitMatch && init?.method === 'POST') {
        return json(await store.commit({
          reservationToken: decodeURIComponent(commitMatch[1]!),
          claim: body.claim,
          now,
        }));
      }
      const cancelMatch = url.pathname.match(/^\/api\/nearby-cohorts\/reservations\/([^/]+)$/);
      if (cancelMatch && init?.method === 'DELETE') {
        store.cancelReservation(decodeURIComponent(cancelMatch[1]!));
        return json(null, 204);
      }
      return json({ error: 'not found' }, 404);
    } catch (error) {
      const status = error instanceof NearbyCohortStoreError ? error.status : 400;
      const code = error instanceof NearbyCohortStoreError ? error.code : 'error';
      return json({ code, error: error instanceof Error ? error.message : String(error) }, status);
    }
  };
}

function handoff(log: string[]): NearbyCohortHandoff {
  return {
    stopOld: async (group) => { log.push(`stop:${group.roomId}`); },
    startTarget: async (group) => { log.push(`start:${group.roomId}`); },
    restoreOld: async (group) => { log.push(`restore:${group.roomId}`); },
  };
}

describe('OPEN-40-G2 client/index integration', () => {
  it('claims a verified default, switches atomically, and restores the committed visit on restart', async () => {
    const store = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const transition = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: '8'.repeat(64),
      createdAt: now.toISOString(),
    });
    await store.publishTransitions(checkpoint, [transition], now);
    const signingPair = await SEA.pair() as SeaSigningPair;
    const context: NearbyCohortTraversalContext = {
      checkpoint,
      userId: 'alice',
      pair: signingPair,
      privacyMode: 'regional',
      defaultGroup: transition.toGroups[0]!,
    };
    const storage = new MemoryStorage();
    const api = new WebNearbyCohortTraversalApi({
      apiBase: () => 'https://cohort.test',
      fetch: storeFetch(store),
      now: () => now,
    });
    const firstLog: string[] = [];
    const first = new NearbyCohortTraversalClient({ api, storage, handoff: handoff(firstLog), now: () => now });
    expect(await first.initialize(context)).toEqual(context.defaultGroup);
    expect(store.activeClaim(checkpoint, signingPair.pub, now)?.group).toEqual(context.defaultGroup);

    await first.meetAnotherGroup();
    expect({ status: first.getSnapshot().status, error: first.getLastError() })
      .toEqual({ status: 'ready', error: null });
    const visited = first.getActiveGroup()!;
    expect(visited.roomId).toBe(transition.toGroups[1]!.roomId);
    expect(firstLog).toEqual([
      `stop:${context.defaultGroup.roomId}`,
      `start:${visited.roomId}`,
    ]);
    expect(store.activeClaim(checkpoint, signingPair.pub, now)?.group).toEqual(visited);

    const restartLog: string[] = [];
    const restarted = new NearbyCohortTraversalClient({
      api,
      storage,
      handoff: handoff(restartLog),
      now: () => now,
    });
    expect(await restarted.initialize(context)).toEqual(visited);
    expect(restartLog).toEqual([]);
    expect(restarted.getSnapshot()).toMatchObject({ isDefaultGroup: false, status: 'ready' });
  });

  it('moves from a replaced parent to its stable child without mis-signing a manual visit', async () => {
    const store = new NearbyCohortStore();
    const root = nearbyCohortRootGroup(checkpoint);
    const signingPair = await SEA.pair() as SeaSigningPair;
    const rootClaim = await createNearbyCohortSeatClaim({
      checkpoint,
      pair: signingPair,
      userId: 'replacement-user',
      privacyMode: 'regional',
      group: root,
      generation: 1,
      previousClaimHash: null,
      now,
    });
    const rootReservation = await store.reserve({ claim: rootClaim, now });
    await store.commit({ reservationToken: rootReservation.reservationToken, claim: rootClaim, now });
    const transition = createNearbyPartitionTransitionV2({
      axis: 'cohort',
      checkpoint,
      fromGroup: root,
      evidenceHash: '7'.repeat(64),
      createdAt: now.toISOString(),
    });
    await store.publishTransitions(checkpoint, [transition], now);
    const context: NearbyCohortTraversalContext = {
      checkpoint,
      userId: 'replacement-user',
      pair: signingPair,
      privacyMode: 'regional',
      defaultGroup: transition.toGroups[0]!,
    };
    const api = new WebNearbyCohortTraversalApi({
      apiBase: () => 'https://cohort.test',
      fetch: storeFetch(store),
      now: () => new Date(now.getTime() + 1_000),
    });
    const client = new NearbyCohortTraversalClient({
      api,
      storage: new MemoryStorage(),
      handoff: handoff([]),
      now: () => new Date(now.getTime() + 1_000),
    });

    await expect(client.initialize(context)).resolves.toEqual(context.defaultGroup);
    expect(store.activeClaim(checkpoint, signingPair.pub, new Date(now.getTime() + 1_000))?.group)
      .toEqual(context.defaultGroup);
  });
});
