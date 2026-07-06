import { ChatroomManager } from '../../server/services/chatroom-manager';
import type { GunService } from '../../server/services/gun-service';
import { ROOM_MEMBERSHIP_TTL_SECONDS } from '../../shared/p2p-runtime';

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
