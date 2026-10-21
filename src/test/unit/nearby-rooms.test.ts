import {
  CONTACTS_ONLY_SCOPE_ID,
  hasNoHubRoster,
  hasRoomChat,
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
