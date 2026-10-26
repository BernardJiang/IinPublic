import { publicLocationBounds, publicLocationContains, snapPublicLocation } from '../../shared/public-location';
import { layoutMapUsers, selfMapPosition, type UserLayoutSource } from '../../web/ui/map-user-layout';

import { createMapUserDots } from '../../web/ui/chatroom-map-view';

const center = snapPublicLocation({ latitude: 32.7157, longitude: -117.1611 }, 1_000);
const source: UserLayoutSource = { selfUserId: 'me', selfPoint: center, roomMemberIds: new Set(['friend']) };
const dot = (userId: string, traveler = false) => ({ ...center, userId, traveler });
const viewport = (scale = 25_000, zoom = 15) => ({
  zoom,
  project: ([lng, lat]: [number, number]) => ({ x: lng * scale, y: -lat * scale }),
  unproject: ([x, y]: [number, number]) => ({ lng: x / scale, lat: -y / scale }),
});

describe('map shared-location layout', () => {
  it('draws the actual public bounds, keeps me centered, and separates both colours on the edges', () => {
    const dots = [dot('me'), dot('friend'), dot('stranger'), dot('friend')];
    const before = JSON.stringify(dots);
    const { groups, boundary } = layoutMapUsers(source, dots, viewport());
    const bounds = publicLocationBounds(center);
    expect(boundary).toEqual([
      [bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.east, bounds.south],
      [bounds.west, bounds.south], [bounds.west, bounds.north],
    ]);
    const self = groups.find((group) => group.kind === 'self')!;
    expect(self).toMatchObject({ latitude: center.latitude, longitude: center.longitude, count: 1, userIds: ['me'] });
    expect(self.displayPoint).toBeUndefined();
    const others = groups.filter((group) => group.kind !== 'self');
    expect(others).toHaveLength(2);
    expect(others[0]!.displayPoint).not.toEqual(others[1]!.displayPoint);
    for (const group of others) {
      const point = group.displayPoint!;
      expect(point.latitude === bounds.south || point.latitude === bounds.north
        || point.longitude === bounds.west || point.longitude === bounds.east).toBe(true);
      expect(group).toMatchObject({ latitude: center.latitude, longitude: center.longitude });
    }
    expect(JSON.stringify(dots)).toBe(before);
  });

  it('shows my exact local GPS fix while preserving the public box and everyone else’s points', () => {
    const gps = { latitude: center.latitude + 0.001, longitude: center.longitude - 0.002 };
    const current = { ...source, selfGpsPoint: gps, selfTraveler: false };
    const before = layoutMapUsers(source, [dot('friend')], viewport());
    const result = layoutMapUsers(current, [dot('friend')], viewport());
    expect(result.boundary).toEqual(before.boundary);
    expect(result.groups.find((group) => group.kind === 'self')).toMatchObject({
      latitude: center.latitude, longitude: center.longitude, displayPoint: gps,
    });
    expect(result.groups.find((group) => group.kind === 'room')).toEqual(before.groups.find((group) => group.kind === 'room'));
    expect(selfMapPosition(current)).toEqual(gps);
    const nextGps = { ...gps, latitude: gps.latitude + 0.0001 };
    expect(layoutMapUsers({ ...current, selfGpsPoint: nextGps }, [], viewport()).groups[0]!.displayPoint).toEqual(nextGps);
  });

  it('uses GPS for a Resident in a Place, but always centers a Traveler even with a cached fix', () => {
    const gps = { latitude: center.latitude + 0.001, longitude: center.longitude - 0.002 };
    const place = { latitude: 48.85, longitude: 2.35 };
    const resident = { ...source, selfGpsPoint: gps, selfTraveler: false };
    expect(layoutMapUsers(resident, [], viewport(), place).groups.find((group) => group.kind === 'self')!.displayPoint).toEqual(gps);
    expect(selfMapPosition(resident, place)).toEqual(gps);
    const traveler = { ...resident, selfTraveler: true };
    const self = layoutMapUsers(traveler, [], viewport(), place).groups.find((group) => group.kind === 'self')!;
    expect(self.displayPoint).toBeUndefined();
    expect(self).toMatchObject(place);
    expect(selfMapPosition(traveler, place)).toEqual(place);
    expect(selfMapPosition(traveler)).toEqual(center);
    expect(layoutMapUsers(traveler, [], viewport()).groups[0]!.displayPoint).toBeUndefined();
  });

  it('passes the local fix only to the Resident map source, leaving public location unchanged', () => {
    const gps = { latitude: center.latitude + 0.001, longitude: center.longitude - 0.002 };
    const input = { selfPoint: center, selfGpsPoint: gps, load: async () => ({ dots: [], density: [] }) };
    const resident = createMapUserDots(input, 'me', [], (key) => key);
    expect(resident.selfPoint).toBe(center);
    expect(resident.selfGpsPoint).toBe(gps);
    expect(createMapUserDots({ ...input, selfTraveler: true }, 'me', [], (key) => key).selfGpsPoint).toBeUndefined();
  });

  it('keeps edge markers away from my actual fix without displacing me', () => {
    const bounds = publicLocationBounds(center);
    const gps = { latitude: bounds.north, longitude: center.longitude };
    const view = viewport();
    const result = layoutMapUsers({ ...source, selfGpsPoint: gps }, Array.from({ length: 30 }, (_, i) => dot(`other-${i}`)), view);
    const selfPixel = view.project([gps.longitude, gps.latitude]);
    for (const group of result.groups.filter((group) => group.kind !== 'self')) {
      const pixel = view.project([group.displayPoint!.longitude, group.displayPoint!.latitude]);
      expect(Math.hypot(pixel.x - selfPixel.x, pixel.y - selfPixel.y)).toBeGreaterThanOrEqual(48);
    }
    expect(result.groups.find((group) => group.kind === 'self')!.displayPoint).toEqual(gps);
    expect(result.groups.filter((group) => group.kind !== 'self').reduce((sum, group) => sum + group.count, 0)).toBe(30);
  });

  it('prioritizes a matched peer as an individual marker instead of hiding her in overflow', () => {
    const dots = Array.from({ length: 50 }, (_, i) => dot(`user-${String(i).padStart(2, '0')}`));
    const current = { ...source, roomMemberIds: new Set(dots.map((person) => person.userId)), matchCounts: new Map([['user-49', 3]]) };
    const result = layoutMapUsers(current, dots, viewport());
    expect(result.groups.find((group) => group.userIds.includes('user-49'))).toMatchObject({ count: 1, matchCount: 3, userIds: ['user-49'] });
    expect(result.groups.filter((group) => group.kind !== 'self').reduce((sum, group) => sum + group.count, 0)).toBe(50);
  });

  it('bounds marker count while accounting for every person exactly once, stably across refresh order', () => {
    const dots = Array.from({ length: 100 }, (_, i) => dot(`person-${String(i).padStart(3, '0')}`, i % 2 === 0));
    const current = { ...source, roomMemberIds: new Set(dots.slice(0, 50).map((person) => person.userId)) };
    const layout = layoutMapUsers(current, dots, viewport());
    const others = layout.groups.filter((group) => group.kind !== 'self');
    expect(others.length).toBeLessThanOrEqual(12);
    expect(others.reduce((sum, group) => sum + group.count, 0)).toBe(100);
    expect(new Set(others.flatMap((group) => group.userIds)).size).toBe(100);
    expect(others.reduce((sum, group) => sum + group.travelers, 0)).toBe(50);
    expect(others.some((group) => group.kind === 'room' && group.count > 1)).toBe(true);
    expect(others.some((group) => group.kind === 'other' && group.count > 1)).toBe(true);
    expect(layoutMapUsers(current, [...dots].reverse(), viewport())).toEqual(layout);
  });

  it('keeps summaries beside me when zoomed out, and expands them again on zoom', () => {
    const dots = [dot('friend'), dot('stranger'), dot('stranger2')];
    const collapsed = layoutMapUsers(source, dots, viewport(100));
    expect(collapsed.groups.filter((group) => group.kind !== 'self').map((group) => group.offset)).toEqual([[-36, 0], [36, 0]]);
    expect(collapsed.groups.find((group) => group.kind === 'other')!.count).toBe(2);
    expect(layoutMapUsers(source, dots, viewport()).groups.filter((group) => group.offset)).toEqual([]);
  });

  it('uses Place membership without GPS, retains travelers, and keeps nonmembers at their public points', () => {
    const place = { latitude: 48.85, longitude: 2.35 };
    const current = { selfUserId: 'me', roomMemberIds: new Set(['me', 'friend', 'visitor']), roomTravelerIds: new Set(['visitor']) };
    const { groups, boundary } = layoutMapUsers(current, [dot('outsider'), dot('friend')], viewport(), place);
    expect(boundary).toHaveLength(5);
    expect(groups.find((group) => group.kind === 'self')).toMatchObject({ ...place, userIds: ['me'] });
    expect(groups.find((group) => group.userIds.includes('friend'))).toMatchObject({ ...place, count: 1 });
    expect(groups.find((group) => group.userIds.includes('visitor'))!.travelers).toBe(1);
    const outsider = groups.find((group) => group.userIds.includes('outsider'))!;
    expect(outsider).toMatchObject({ latitude: center.latitude, longitude: center.longitude });
    expect(outsider.displayPoint).toBeUndefined();
    expect(layoutMapUsers(current, [], viewport(25_000, 13), place).boundary).toEqual([]);
  });

  it('includes Place members beyond the loaded page in the overflow count', () => {
    const place = { latitude: 48.85, longitude: 2.35, memberCount: 1_001 };
    const current = { selfUserId: 'me', roomMemberIds: new Set(['friend', 'visitor']) };
    const { groups } = layoutMapUsers(current, [], viewport(), place);
    const others = groups.filter((group) => group.kind !== 'self');
    expect(others.reduce((sum, group) => sum + group.count, 0)).toBe(1_000);
    expect(others.flatMap((group) => group.userIds).sort()).toEqual(['friend', 'visitor']);
    expect(others.some((group) => group.count === 998 && group.userIds.length === 0)).toBe(true);
    const pending = layoutMapUsers({ ...current, roomMemberIds: new Set<string>() }, [], viewport(), place);
    expect(pending.groups.find((group) => group.kind === 'room')!.count).toBe(1_000);
  });

  it('does not move people outside my cell or invent a location with GPS off', () => {
    const distant = { ...dot('distant'), latitude: center.latitude + 1 };
    const { groups } = layoutMapUsers(source, [distant], viewport());
    expect(groups.find((group) => group.userIds.includes('distant'))!.displayPoint).toBeUndefined();
    const noLocation = { selfUserId: 'me', roomMemberIds: new Set<string>() };
    expect(layoutMapUsers(noLocation, [], viewport())).toEqual({ groups: [], boundary: [] });
  });

  it.each([400, 1_000, 10_000, 50_000] as const)('uses the selected %i m grid, including high latitude and antimeridian wrapping', (precision) => {
    const point = snapPublicLocation({ latitude: 80, longitude: 179.999 }, precision);
    const bounds = publicLocationBounds(point);
    expect((bounds.north - bounds.south) * 111_320).toBeCloseTo(precision);
    expect((bounds.east - bounds.west) * 111_320 * Math.cos(point.latitude * Math.PI / 180)).toBeCloseTo(precision);
    const wrapped = { ...point, longitude: point.longitude > 179 ? point.longitude - 360 : point.longitude };
    expect(publicLocationContains(point, wrapped)).toBe(true);
    const { boundary } = layoutMapUsers({ ...source, selfPoint: point }, [], viewport());
    expect(boundary.every((vertex) => Math.abs(vertex[0] - point.longitude) < 2)).toBe(true);
  });
});
