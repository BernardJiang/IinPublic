/** @jest-environment jsdom */

import {
  capacityOwner,
  isNoticeForStay,
  orderMembersFifo,
  overflowMembers,
  parseRoomCapacity,
  type CapacityMember,
} from '../../shared/chatroom-capacity';
import { ChatroomCapacityController } from '../../web/services/chatroom-capacity-controller';
import { getLocationChatroomPath } from '../../shared/location-to-chatroom';
import type { GPSCoordinate } from '../../shared/types';

const m = (userId: string, joinedAt: string): CapacityMember => ({ userId, joinedAt });
const t = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();

describe('shared chatroom capacity rule', () => {
  it('orders oldest first and breaks equal timestamps by userId', () => {
    const ordered = orderMembersFifo([m('c', t(2)), m('b', t(1)), m('a', t(1))]);
    expect(ordered.map((x) => x.userId)).toEqual(['a', 'b', 'c']);
  });

  it('puts an unparseable joinedAt on the newest side so it is never evicted first', () => {
    const ordered = orderMembersFifo([m('bad', 'garbage'), m('a', t(5)), m('b', '')]);
    expect(ordered.map((x) => x.userId)).toEqual(['a', 'b', 'bad']);
  });

  it('returns the n - capacity oldest members as overflow', () => {
    const members = ['a', 'b', 'c', 'd', 'e'].map((id, i) => m(id, t(i)));
    expect(overflowMembers(members, 3).map((x) => x.userId)).toEqual(['a', 'b']);
    expect(overflowMembers(members, 5)).toEqual([]);
    expect(overflowMembers(members, 99)).toEqual([]);
  });

  it('names the newest member as the room owner', () => {
    expect(capacityOwner([m('a', t(1)), m('z', t(9)), m('b', t(3))])).toBe('z');
    expect(capacityOwner([])).toBeNull();
  });

  it('is monotone: overflow on any partial view implies overflow on the full list', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 300; round += 1) {
      const n = 2 + Math.floor(rand() * 12);
      // Few distinct timestamps on purpose, to exercise the userId tie-break.
      const full = Array.from({ length: n }, (_, i) => m(`u${i}`, t(Math.floor(rand() * 5))));
      const capacity = 1 + Math.floor(rand() * n);
      const fullOverflow = new Set(overflowMembers(full, capacity).map((x) => x.userId));
      const partial = full.filter(() => rand() > 0.3);
      for (const evicted of overflowMembers(partial, capacity)) {
        expect(fullOverflow.has(evicted.userId)).toBe(true);
      }
    }
  });

  it('gives every peer the same answer regardless of input order', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => m(id, t(i % 3)));
    const forward = overflowMembers(members, 4).map((x) => x.userId);
    const reversed = overflowMembers([...members].reverse(), 4).map((x) => x.userId);
    expect(reversed).toEqual(forward);
  });

  it('accepts only positive whole capacities', () => {
    expect(parseRoomCapacity(498)).toBe(498);
    expect(parseRoomCapacity('7')).toBe(7);
    expect(parseRoomCapacity(0)).toBeNull();
    expect(parseRoomCapacity(2.5)).toBeNull();
    expect(parseRoomCapacity(undefined)).toBeNull();
  });

  it('only honours a notice for the evictee\'s current stay', () => {
    expect(isNoticeForStay({ evicteeJoinedAt: t(1) }, t(1))).toBe(true);
    expect(isNoticeForStay({ evicteeJoinedAt: t(1) }, t(2))).toBe(false);
    expect(isNoticeForStay({ evicteeJoinedAt: t(1) }, undefined)).toBe(false);
    expect(isNoticeForStay(null, t(1))).toBe(false);
  });
});

/** Minimal in-memory Gun: leaf nodes keyed by path, `map().on` over direct children. */
class FakeGun {
  private leaves = new Map<string, any>();
  private nodeSubs: Array<{ path: string; cb: (d: any, k: string) => void }> = [];
  private mapSubs: Array<{ prefix: string; cb: (d: any, k: string) => void }> = [];

  read(path: string): any {
    return this.leaves.get(path);
  }

  private write(path: string, value: any): void {
    if (value === null) this.leaves.delete(path);
    else this.leaves.set(path, { ...(this.leaves.get(path) || {}), ...value });
    const data = this.leaves.get(path);
    const slash = path.lastIndexOf('/');
    const parent = path.slice(0, slash);
    const key = path.slice(slash + 1);
    this.nodeSubs.filter((s) => s.path === path).forEach((s) => s.cb(data, key));
    this.mapSubs.filter((s) => s.prefix === parent).forEach((s) => s.cb(data, key));
  }

  node(path: string): any {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- object-literal methods below need the graph
    const self = this;
    return {
      get: (key: string) => self.node(`${path}/${key}`),
      put(value: any, cb?: (ack: any) => void) {
        self.write(path, value);
        cb?.({ ok: 1 });
        return this;
      },
      once(cb: (d: any) => void) {
        cb(self.leaves.get(path));
      },
      on(cb: (d: any, k: string) => void) {
        const sub = { path, cb };
        self.nodeSubs.push(sub);
        if (self.leaves.has(path)) cb(self.leaves.get(path), path.slice(path.lastIndexOf('/') + 1));
        return { off: () => { self.nodeSubs = self.nodeSubs.filter((s) => s !== sub); } };
      },
      map() {
        return {
          on(cb: (d: any, k: string) => void) {
            const sub = { prefix: path, cb };
            self.mapSubs.push(sub);
            for (const [p, v] of self.leaves) {
              if (p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/')) cb(v, p.slice(path.length + 1));
            }
            return { off: () => { self.mapSubs = self.mapSubs.filter((s) => s !== sub); } };
          },
        };
      },
    };
  }
}

const SF: GPSCoordinate = { latitude: 37.7749, longitude: -122.4194, accuracy: 10, timestamp: new Date() };

describe('ChatroomCapacityController (notice-driven eviction cascade)', () => {
  let gun: FakeGun;
  let clock: number;
  let peers: Map<string, { controller: ChatroomCapacityController; room: string | undefined; moved: string[] }>;
  const path = getLocationChatroomPath(SF);

  const nextIso = () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString();

  function addPeer(userId: string, stayConnected = true): void {
    const peer: { controller: ChatroomCapacityController; room: string | undefined; moved: string[] } = {
      controller: undefined as never,
      room: undefined,
      moved: [],
    };
    peer.controller = new ChatroomCapacityController({
      getGun: () => gun.node(''),
      fifoEnabled: () => true,
      isFreshMember: () => true,
      getCurrentRoom: () => peer.room,
      getLocation: () => SF,
      getStageName: () => userId,
      moveForEviction: async (from, id, child, _stage, onMoved) => {
        if (peer.room !== from) return false;
        peer.controller.stop(from);
        gun.node(`/chatrooms/${from}/users/${id}`).put({ isActive: false, leftAt: nextIso(), movedTo: child });
        peer.room = child;
        const at = nextIso();
        gun.node(`/chatrooms/${child}/users/${id}`).put({ userId: id, isActive: true, joinedAt: at, lastSeen: at });
        if (stayConnected) peer.controller.start(child, id, onMoved);
        return true;
      },
    });
    peers.set(userId, peer);
  }

  async function join(userId: string, room: string): Promise<void> {
    const peer = peers.get(userId)!;
    const onMoved = (r: string) => peer.moved.push(r);
    peer.room = room;
    const at = nextIso();
    gun.node(`/chatrooms/${room}/users/${userId}`).put({ userId, isActive: true, joinedAt: at, lastSeen: at });
    peer.controller.start(room, userId, onMoved);
  }

  const activeIn = (room: string): string[] =>
    ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']
      .filter((id) => gun.read(`/chatrooms/${room}/users/${id}`)?.isActive === true)
      .sort();

  const settle = async () => {
    // Several reconcile windows so notices, self-eviction and the cascade all get to run.
    for (let i = 0; i < 12; i += 1) await jest.advanceTimersByTimeAsync(1600);
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    gun = new FakeGun();
    clock = 0;
    peers = new Map();
    ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'].forEach((id) => addPeer(id));
  });

  afterEach(() => {
    peers.forEach((p) => p.controller.stop());
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('writes the default capacity record once and then honours the stored value', async () => {
    const c = peers.get('u1')!.controller;
    expect(await c.resolveCapacity('room-a', 'u1')).toBe(498);
    expect(gun.read('/chatroomCapacity/room-a')).toEqual(expect.objectContaining({ capacity: 498, setBy: 'u1' }));

    gun.node('/chatroomCapacity/room-b').put({ capacity: 2, setBy: 'other', setAt: 'x' });
    expect(await peers.get('u2')!.controller.resolveCapacity('room-b', 'u2')).toBe(2);
  });

  it('moves the oldest member down when a newcomer pushes the room over capacity', async () => {
    gun.node(`/chatroomCapacity/${path[0]}`).put({ capacity: 3, setBy: 't', setAt: 'x' });
    for (const id of ['u1', 'u2', 'u3']) await join(id, path[0]!);
    await settle();
    expect(activeIn(path[0]!)).toEqual(['u1', 'u2', 'u3']);

    await join('u4', path[0]!);
    await settle();

    expect(activeIn(path[0]!)).toEqual(['u2', 'u3', 'u4']);
    expect(activeIn(path[1]!)).toEqual(['u1']);
    expect(peers.get('u1')!.moved).toContain(path[1]);
    expect(gun.read(`/chatrooms/${path[0]}/users/u1`)?.movedTo).toBe(path[1]);
  });

  it('cascades: the child room is trimmed too, all the way down', async () => {
    gun.node(`/chatroomCapacity/${path[0]}`).put({ capacity: 2, setBy: 't', setAt: 'x' });
    gun.node(`/chatroomCapacity/${path[1]}`).put({ capacity: 1, setBy: 't', setAt: 'x' });
    for (const id of ['u1', 'u2']) await join(id, path[0]!);
    await settle();
    await join('u3', path[0]!);
    await settle();
    await join('u4', path[0]!);
    await settle();

    const cap = (room: string) => (room === path[0] ? 2 : room === path[1] ? 1 : 498);
    for (const room of path) expect(activeIn(room!).length).toBeLessThanOrEqual(cap(room!));
    // Nobody vanished: everyone is active somewhere.
    const everyone = path.flatMap((room) => activeIn(room!));
    expect(everyone.sort()).toEqual(['u1', 'u2', 'u3', 'u4']);
  });

  it('ignores a notice once the member has already left by hand (no race with a manual move)', async () => {
    gun.node(`/chatroomCapacity/${path[0]}`).put({ capacity: 1, setBy: 't', setAt: 'x' });
    await join('u1', path[0]!);
    await settle();

    // u1 is about to switch rooms manually: it is no longer in path[0] when the notice lands.
    peers.get('u1')!.room = 'somewhere-else';
    await join('u2', path[0]!);
    await settle();

    expect(peers.get('u1')!.moved).toEqual([]);
    expect(activeIn(path[1]!)).not.toContain('u1');
  });

  it('does nothing for a notice addressed to an earlier stay of the same user', async () => {
    gun.node(`/chatroomCapacity/${path[0]}`).put({ capacity: 5, setBy: 't', setAt: 'x' });
    await join('u1', path[0]!);
    await settle();
    gun.node(`/chatrooms/${path[0]}/evictions/u1/u9`).put({
      by: 'u9', at: nextIso(), capacity: 1, evicteeJoinedAt: t(-100),
    });
    await settle();
    expect(activeIn(path[0]!)).toEqual(['u1']);
    expect(peers.get('u1')!.moved).toEqual([]);
  });

  it('lets only the newest member send notices, even when several peers watch the room', async () => {
    gun.node(`/chatroomCapacity/${path[0]}`).put({ capacity: 2, setBy: 't', setAt: 'x' });
    for (const id of ['u1', 'u2', 'u3']) await join(id, path[0]!);
    await settle();
    const authors = new Set<string>();
    for (const evictee of ['u1', 'u2', 'u3']) {
      for (const author of ['u1', 'u2', 'u3']) {
        if (gun.read(`/chatrooms/${path[0]}/evictions/${evictee}/${author}`)) authors.add(author);
      }
    }
    expect([...authors]).toEqual(['u3']);
  });
});
