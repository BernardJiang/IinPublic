import { ChatroomManager } from '../../server/services/chatroom-manager';
import type { GunService } from '../../server/services/gun-service';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';
import { TECHSUPPORT_ROOT_USER_ID, TECHSUPPORT_STAGE_NAME } from '../../shared/techsupport';
import {
  DEFAULT_VISIT_COUNTER_MAX_SLOTS,
  prunedVisitAggregatePath,
  readPrunedVisitAggregate,
  readVisitCounterState,
  visitCounterMapPath,
  visitTotalsWithPruned,
} from '../../shared/visit-counter';

class MemoryGunService {
  private state: Record<string, any> = {};

  async getPath(path: string[]): Promise<any> {
    return path.reduce<any>((value, segment) => value?.[segment], this.state);
  }

  async putPath(path: string[], value: any): Promise<void> {
    let target = this.state;
    path.slice(0, -1).forEach((segment) => {
      target[segment] = target[segment] || {};
      target = target[segment];
    });
    target[path[path.length - 1]] = value;
  }

  getGun(): any {
    const readPath = (path: string[]) => path.reduce<any>((value, segment) => value?.[segment], this.state);
    const makeRef = (path: string[]): any => ({
      get: (segment: string) => makeRef([...path, segment]),
      map: () => ({
        on: (callback: (data: unknown, key: string) => void) => {
          const node = readPath(path);
          if (node && typeof node === 'object') {
            for (const [key, value] of Object.entries(node)) {
              callback(value, key);
            }
          }
        },
        off: jest.fn(),
      }),
    });
    return makeRef([]);
  }
}

describe('ChatroomManager visit accounting', () => {
  function buildManager(): ChatroomManager {
    return new ChatroomManager(new MemoryGunService() as unknown as GunService);
  }

  it('does not count duplicate active joins and preserves lifetime counters after leaving', async () => {
    const manager = buildManager();
    await manager.createChatroom({ id: 'room_1', name: 'Room', type: 'custom', createdBy: 'owner' });

    await manager.joinChatroom('room_1', 'user_1', 'Tom');
    await manager.joinChatroom('room_1', 'user_1', 'Tom');
    expect(await manager.getActiveMembersWithStageName('room_1')).toEqual([{ userId: 'user_1', stageName: 'Tom' }]);
    expect(await (manager as any).gunService.getPath(['public', 'room-member-counts', 'room_1']))
      .toMatchObject({ count: 1 });
    expect(await manager.getChatroom('room_1')).toMatchObject({ visitCount: 1, uniqueVisitorCount: 1 });

    await manager.leaveChatroom('room_1', 'user_1');
    expect(await manager.getActiveMembersWithStageName('room_1')).toEqual([]);
    expect(await (manager as any).gunService.getPath(['public', 'room-member-counts', 'room_1']))
      .toMatchObject({ count: 0 });
    expect(await manager.getChatroom('room_1')).toMatchObject({ visitCount: 1, uniqueVisitorCount: 1 });

    await manager.joinChatroom('room_1', 'user_1', 'Tom');
    expect(await manager.getChatroom('room_1')).toMatchObject({ visitCount: 2, uniqueVisitorCount: 1 });
  });

  it('triggers a prune the moment recordVisit pushes a room past the slot threshold', async () => {
    const manager = buildManager();
    const gunService = (manager as any).gunService as MemoryGunService;
    await manager.createChatroom({ id: 'room_flood', name: 'Flood Room', type: 'custom', createdBy: 'owner' });

    // Seed one slot over the default threshold directly (fast) rather than driving
    // DEFAULT_VISIT_COUNTER_MAX_SLOTS+1 real joins through the manager.
    for (let i = 0; i < DEFAULT_VISIT_COUNTER_MAX_SLOTS; i++) {
      const ts = new Date(2026, 6, 25, 0, 0, i).toISOString();
      await gunService.putPath(['chatrooms', 'room_flood', 'visitCounter', `u${i}`], {
        userId: `u${i}`,
        count: 1,
        firstVisitedAt: ts,
        lastVisitedAt: ts,
      });
    }
    const beforeTotals = visitTotalsWithPruned(
      readVisitCounterState(await gunService.getPath(visitCounterMapPath('room_flood'))),
      undefined,
    );
    expect(beforeTotals).toEqual({ visitCount: DEFAULT_VISIT_COUNTER_MAX_SLOTS, uniqueVisitorCount: DEFAULT_VISIT_COUNTER_MAX_SLOTS });

    // The (DEFAULT_VISIT_COUNTER_MAX_SLOTS + 1)th visitor's own join is what crosses the
    // threshold — recordVisit fires the prune check itself, same as production.
    await manager.joinChatroom('room_flood', 'newest_user', 'Newest');
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the fire-and-forget prune settle

    const liveState = readVisitCounterState(await gunService.getPath(visitCounterMapPath('room_flood')));
    expect(Object.keys(liveState)).toHaveLength(DEFAULT_VISIT_COUNTER_MAX_SLOTS);
    // The oldest slot (u0, earliest lastVisitedAt) must be the one pruned away.
    expect(liveState.u0).toBeUndefined();
    expect(liveState.newest_user).toBeDefined();

    const prunedAggregate = readPrunedVisitAggregate(await gunService.getPath(prunedVisitAggregatePath('room_flood')));
    expect(prunedAggregate.count).toBe(1);
    expect(prunedAggregate.uniqueCount).toBe(1);

    // The lifetime badge is numerically identical across the prune: still
    // DEFAULT_VISIT_COUNTER_MAX_SLOTS + 1 total visits/visitors, split live vs. pruned.
    const afterTotals = visitTotalsWithPruned(liveState, prunedAggregate);
    expect(afterTotals).toEqual({
      visitCount: DEFAULT_VISIT_COUNTER_MAX_SLOTS + 1,
      uniqueVisitorCount: DEFAULT_VISIT_COUNTER_MAX_SLOTS + 1,
    });
    expect(await manager.getChatroom('room_flood')).toMatchObject(afterTotals);
  });

  it('does not prune anything when the room is still under the threshold', async () => {
    const manager = buildManager();
    const gunService = (manager as any).gunService as MemoryGunService;

    await manager.joinChatroom('room_small', 'user_1', 'Tom');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const liveState = readVisitCounterState(await gunService.getPath(visitCounterMapPath('room_small')));
    expect(Object.keys(liveState)).toEqual(['user_1']);
    const prunedAggregate = await gunService.getPath(prunedVisitAggregatePath('room_small'));
    expect(prunedAggregate).toBeUndefined();
  });

  it('expires stale active room memberships and republishes the public count', async () => {
    const manager = buildManager();
    const gunService = (manager as any).gunService as MemoryGunService;
    const old = new Date(Date.now() - (ROOM_MEMBERSHIP_TTL_SECONDS + 5) * 1000).toISOString();
    const fresh = new Date().toISOString();

    await gunService.putPath(['chatrooms', 'room_ttl', 'users', 'stale_user'], {
      userId: 'stale_user',
      stageName: 'Stale',
      isActive: true,
      joinedAt: old,
      lastSeen: old,
    });
    await gunService.putPath(['chatroomMembers', 'room_ttl', 'stale_user'], {
      stageName: 'Stale',
      isActive: true,
      joinedAt: old,
      lastSeen: old,
    });
    await gunService.putPath(['chatrooms', 'room_ttl', 'users', 'fresh_user'], {
      userId: 'fresh_user',
      stageName: 'Fresh',
      isActive: true,
      joinedAt: fresh,
      lastSeen: fresh,
    });

    expect(await manager.getActiveMembersWithStageName('room_ttl')).toEqual([
      { userId: 'fresh_user', stageName: 'Fresh' },
    ]);
    expect(await gunService.getPath(['chatrooms', 'room_ttl', 'users', 'stale_user']))
      .toMatchObject({ isActive: false, stalePresenceExpired: true });
    expect(await gunService.getPath(['chatroomMembers', 'room_ttl', 'stale_user']))
      .toMatchObject({ isActive: false, stalePresenceExpired: true });
    expect(await gunService.getPath(['public', 'room-member-counts', 'room_ttl']))
      .toMatchObject({ count: 1 });
  });

  it('retains visitor history when a custom room is soft deleted', async () => {
    const manager = buildManager();
    await manager.createChatroom({ id: 'room_2', name: 'Retired Room', type: 'custom', createdBy: 'owner' });
    await manager.joinChatroom('room_2', 'user_1', 'Tom');
    await manager.deleteChatroom('room_2', 'owner');

    expect(await manager.getAllChatrooms()).toEqual([]);
    expect(await manager.getChatroom('room_2')).toMatchObject({
      isActive: false,
      visitCount: 1,
      uniqueVisitorCount: 1,
    });
  });
});

describe('ChatroomManager TechSupport built-in presence (docs/TODO.md K1)', () => {
  function buildManager(): ChatroomManager {
    return new ChatroomManager(new MemoryGunService() as unknown as GunService);
  }

  it('seedTechSupportGlobalMembership writes one active member row and publishes the count', async () => {
    const manager = buildManager();
    const gunService = (manager as any).gunService as MemoryGunService;

    await manager.seedTechSupportGlobalMembership();

    expect(await gunService.getPath(['chatrooms', 'global', 'users', TECHSUPPORT_ROOT_USER_ID]))
      .toMatchObject({ userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME, isActive: true });
    expect(await gunService.getPath(['chatroomMembers', 'global', TECHSUPPORT_ROOT_USER_ID]))
      .toMatchObject({ userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME, isActive: true });
    expect(await manager.getActiveMembersWithStageName('global')).toEqual([
      { userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the fire-and-forget count publish settle
    expect(await gunService.getPath(['public', 'room-member-counts', 'global'])).toMatchObject({ count: 1 });
  });

  it('never evicts TechSupport from the fast in-memory path even long past the TTL (K1-3)', async () => {
    const manager = buildManager();
    await manager.seedTechSupportGlobalMembership();

    // Simulate a TechSupport device that seeded once and never heartbeat again — backdate its
    // fast-path lastSeen the same way a stale ordinary member would look after the TTL.
    const old = new Date(Date.now() - (ROOM_MEMBERSHIP_TTL_SECONDS + 5) * 1000).toISOString();
    (manager as any).fastActiveMembers.get('global').set(TECHSUPPORT_ROOT_USER_ID, {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      lastSeen: old,
    });

    expect(await manager.getActiveMembersWithStageName('global')).toEqual([
      { userId: TECHSUPPORT_ROOT_USER_ID, stageName: TECHSUPPORT_STAGE_NAME },
    ]);
  });

  it('headcount is exactly 2 once an ordinary user joins alongside the seeded TechSupport row', async () => {
    const manager = buildManager();
    await manager.seedTechSupportGlobalMembership();
    await manager.addMemberFast('global', 'user_1', 'Alice');

    const members = await manager.getActiveMembersWithStageName('global');
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.userId).sort()).toEqual([TECHSUPPORT_ROOT_USER_ID, 'user_1'].sort());
  });

  it('re-seeding refreshes lastSeen so a boot seed after reset never reads as stale', async () => {
    const manager = buildManager();
    await manager.seedTechSupportGlobalMembership();
    const first = await (manager as any).gunService.getPath(['chatrooms', 'global', 'users', TECHSUPPORT_ROOT_USER_ID]);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.seedTechSupportGlobalMembership();
    const second = await (manager as any).gunService.getPath(['chatrooms', 'global', 'users', TECHSUPPORT_ROOT_USER_ID]);

    expect(Date.parse(second.lastSeen)).toBeGreaterThanOrEqual(Date.parse(first.lastSeen));
  });
});
