import { CONFIG } from '../../shared/config';
import {
  EVICTION_COOLDOWN_CAP_MS,
  evictionDestination,
  isSelfOrAbove,
  parentHasHeadroom,
  promotionBlockedUntil,
  promotionHeadroom,
  promotionTarget,
  pruneEvictionHistory,
  type RoutingAnchor,
} from '../../shared/room-routing';
import { parentTileId, tileAncestorAt, tileIdAt, tileLineage } from '../../shared/room-tiles';

const SD = { latitude: 32.7157, longitude: -117.1611 };
const sd = (layer: number) => tileIdAt(layer, SD.latitude, SD.longitude);
const atSD: RoutingAnchor = { kind: 'position', ...SD };
const none: RoutingAnchor = { kind: 'none' };
const MIN = 60_000;

describe('tile lineage', () => {
  it('nests 16 children per tile and walks back up to L1', () => {
    expect(tileLineage(sd(4))).toEqual([sd(1), sd(2), sd(3), sd(4)]);
    expect(parentTileId(sd(2))).toBe(sd(1));
    expect(parentTileId(sd(1))).toBeNull();
    expect(tileAncestorAt(sd(4), 2)).toBe(sd(2));
    expect(tileAncestorAt(sd(2), 3)).toBeNull();
  });
});

describe('evictionDestination (down one layer)', () => {
  it('Global → L1 → L2 → L3 → L4 toward the GPS position, then splits at L4', () => {
    expect(evictionDestination(CONFIG.GLOBAL_CHATROOM_ID, atSD)).toEqual({ kind: 'room', roomId: sd(1) });
    expect(evictionDestination(sd(1), atSD)).toEqual({ kind: 'room', roomId: sd(2) });
    expect(evictionDestination(sd(3), atSD)).toEqual({ kind: 'room', roomId: sd(4) });
    expect(evictionDestination(sd(4), atSD)).toEqual({ kind: 'split' });
  });

  it('Global without any anchor → the non-geographic Global overflow family', () => {
    expect(evictionDestination(CONFIG.GLOBAL_CHATROOM_ID, none)).toEqual({ kind: 'room', roomId: CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID });
    expect(evictionDestination(CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID, none)).toEqual({ kind: 'split' });
  });

  it('a GPS-less home tile (any layer) is followed down, then the home tile splits in place', () => {
    const home: RoutingAnchor = { kind: 'home-tile', tileId: sd(2) };
    expect(evictionDestination(CONFIG.GLOBAL_CHATROOM_ID, home)).toEqual({ kind: 'room', roomId: sd(1) });
    expect(evictionDestination(sd(1), home)).toEqual({ kind: 'room', roomId: sd(2) });
    expect(evictionDestination(sd(2), home)).toEqual({ kind: 'split' });
  });

  it('a traveller whose position is outside the full tile splits in place (no wrong-region descent)', () => {
    const london: RoutingAnchor = { kind: 'position', latitude: 51.5, longitude: -0.12 };
    expect(evictionDestination(sd(1), london)).toEqual({ kind: 'split' });
  });

  it('custom rooms and numbered rooms always split within their own family', () => {
    expect(evictionDestination('room_abc', atSD)).toEqual({ kind: 'split' });
    expect(evictionDestination(`${sd(1)}_part_2`, atSD)).toEqual({ kind: 'split' });
  });
});

describe('promotionTarget (up one step)', () => {
  it('walks parts → base, tiles → parent → Global, overflow → Global', () => {
    expect(promotionTarget(`${sd(4)}_part_3`)).toBe(`${sd(4)}_part_2`);
    expect(promotionTarget(`${sd(4)}_part_2`)).toBe(sd(4));
    expect(promotionTarget(sd(4))).toBe(sd(3));
    expect(promotionTarget(sd(1))).toBe(CONFIG.GLOBAL_CHATROOM_ID);
    expect(promotionTarget(CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID)).toBe(CONFIG.GLOBAL_CHATROOM_ID);
    expect(promotionTarget(`${CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID}_part_2`)).toBe(CONFIG.GLOBAL_UNKNOWN_CHATROOM_ID);
  });

  it('moves a legacy 1 km grid room up to its L4 tile', () => {
    expect(promotionTarget('region_32.71_-117.17_room_0')).toBe(sd(4));
  });

  it('never moves anyone up out of a custom room; its numbered rooms shrink back into it like a stack', () => {
    const cafe = 'place_32.71_-117.17_0123456789abcdef01234567';
    expect(promotionTarget(cafe)).toBeNull();
    expect(promotionTarget(`${cafe}_part_3`)).toBe(`${cafe}_part_2`);
    expect(promotionTarget(`${cafe}_part_2`)).toBe(cafe);
    expect(isSelfOrAbove(CONFIG.GLOBAL_CHATROOM_ID, `${cafe}_part_2`)).toBe(false);
    expect(evictionDestination(cafe, atSD)).toEqual({ kind: 'split' });
    expect(promotionTarget(CONFIG.GLOBAL_CHATROOM_ID)).toBeNull();
    expect(promotionTarget('room_abc')).toBeNull();
  });

  it('isSelfOrAbove follows the upward chain', () => {
    expect(isSelfOrAbove(CONFIG.GLOBAL_CHATROOM_ID, `${sd(4)}_part_2`)).toBe(true);
    expect(isSelfOrAbove(sd(2), sd(4))).toBe(true);
    expect(isSelfOrAbove(sd(4), sd(2))).toBe(false);
    expect(isSelfOrAbove(sd(1), tileIdAt(4, 51.5, -0.12))).toBe(false);
  });
});

describe('headroom and the eviction cooldown', () => {
  it('needs 10% headroom above (at least one seat)', () => {
    expect(promotionHeadroom(498)).toBe(50);
    expect(parentHasHeadroom(448, 498)).toBe(true);
    expect(parentHasHeadroom(449, 498)).toBe(false);
    expect(promotionHeadroom(3)).toBe(1);
    expect(parentHasHeadroom(2, 3)).toBe(true);
    expect(parentHasHeadroom(3, 3)).toBe(false);
  });

  it('blocks promotion into the room (and anything above it) for 15 min, doubling, capped at 4 h', () => {
    const now = 10 * 60 * MIN;
    const base = 15 * MIN;
    const once = [{ room: sd(1), at: now - MIN }];
    expect(promotionBlockedUntil(sd(1), once, now, base)).toBe(now - MIN + 15 * MIN);
    expect(promotionBlockedUntil(CONFIG.GLOBAL_CHATROOM_ID, once, now, base)).toBe(now - MIN + 15 * MIN);
    // A room below the one evicted from is not blocked.
    expect(promotionBlockedUntil(sd(2), once, now, base)).toBe(0);

    const twice = [{ room: sd(1), at: now - 10 * MIN }, { room: sd(1), at: now - MIN }];
    expect(promotionBlockedUntil(sd(1), twice, now, base)).toBe(now - MIN + 30 * MIN);

    const many = Array.from({ length: 6 }, (_, i) => ({ room: sd(1), at: now - (6 - i) * MIN }));
    expect(promotionBlockedUntil(sd(1), many, now, base)).toBe(now - MIN + EVICTION_COOLDOWN_CAP_MS);

    expect(promotionBlockedUntil(sd(1), once, now + 15 * MIN, base)).toBe(0);
  });

  it('forgets evictions after 24 h and drops malformed records', () => {
    const now = 48 * 60 * MIN;
    const history = [
      { room: sd(1), at: now - 25 * 60 * MIN },
      { room: sd(1), at: now - MIN },
      { room: 7 as unknown as string, at: now },
    ];
    expect(pruneEvictionHistory(history, now)).toEqual([{ room: sd(1), at: now - MIN }]);
  });
});
