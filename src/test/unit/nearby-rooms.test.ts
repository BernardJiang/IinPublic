import {
  CONTACTS_ONLY_SCOPE_ID,
  hasNoHubRoster,
  hasRoomChat,
  isCatchUpRecipient,
  isLocalOnlyRoomScope,
  isPersonalListScope,
  isNearbyPublicMode,
  isNearbyRoomId,
  nearbyBasePrecisionMeters,
  NEARBY_V3_ROOM_ID,
} from '../../shared/nearby-rooms';

describe('Nearby scopes (§3.7)', () => {
  test('Nearby is one local scope, never a shared room id', () => {
    expect(isNearbyRoomId(NEARBY_V3_ROOM_ID)).toBe(true);
    // Retired v2 room ids are not Nearby any more: a saved one migrates to the personal list.
    expect(isNearbyRoomId('nearby_v2_e1_0123456789abcdef01234567')).toBe(false);
    expect(isNearbyRoomId('nearby_v1_e1_p1000_g0_0123456789abcdef01234567')).toBe(false);
    expect(isNearbyRoomId('place_32.71_-117.17_abcdefabcdef')).toBe(false);
  });

  test('Nearby and Places are personal lists with no hub roster; only a Place has a chat feed', () => {
    const place = 'place_32.71_-117.17_abcdefabcdef';
    expect(hasNoHubRoster(NEARBY_V3_ROOM_ID)).toBe(true);
    expect(hasNoHubRoster(CONTACTS_ONLY_SCOPE_ID)).toBe(true);
    expect(hasNoHubRoster(place)).toBe(true);
    expect(isLocalOnlyRoomScope(NEARBY_V3_ROOM_ID)).toBe(false);
    expect(isPersonalListScope(NEARBY_V3_ROOM_ID)).toBe(true);
    expect(isPersonalListScope(place)).toBe(true);
    expect(isPersonalListScope(CONTACTS_ONLY_SCOPE_ID)).toBe(false);
    expect(hasRoomChat(place)).toBe(true);
    expect(hasRoomChat(NEARBY_V3_ROOM_ID)).toBe(false);
  });

  test('each public privacy mode snaps the public point to its own precision', () => {
    expect(nearbyBasePrecisionMeters('close-nearby')).toBe(400);
    expect(nearbyBasePrecisionMeters('neighborhood')).toBe(1_000);
    expect(nearbyBasePrecisionMeters('citywide')).toBe(10_000);
    expect(nearbyBasePrecisionMeters('regional')).toBe(50_000);
    expect(isNearbyPublicMode('contacts-only')).toBe(false);
    expect(isNearbyPublicMode('location-off')).toBe(false);
  });
});

describe('automatic catch-up recipients (OPEN-86 E2)', () => {
  it('in Nearby and Places reaches only my current list, not whoever links to me', () => {
    const list = new Set(['on-my-page']);
    expect(isCatchUpRecipient(NEARBY_V3_ROOM_ID, 'on-my-page', list)).toBe(true);
    // Their page holds me, mine does not hold them: a link from their side is only a route.
    expect(isCatchUpRecipient(NEARBY_V3_ROOM_ID, 'lists-me-one-way', list)).toBe(false);
    expect(isCatchUpRecipient('place_32.71_-117.17_abcdefabcdef', 'lists-me-one-way', list)).toBe(false);
  });

  it('keeps the roster rule of other scopes', () => {
    expect(isCatchUpRecipient('some-shared-room', 'anyone', new Set())).toBe(true);
  });
});
