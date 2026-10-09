/** @jest-environment jsdom */

import { WebChatroomService } from '../../web/services/web-chatroom-service';
import type { GPSCoordinate } from '../../shared/types';
import { CONTACTS_ONLY_SCOPE_ID, isNearbyRoomId } from '../../shared/nearby-rooms';

const SAN_DIEGO: GPSCoordinate = {
  latitude: 32.7157,
  longitude: -117.1611,
  accuracy: 10,
  timestamp: new Date('2026-10-06T12:00:00.000Z'),
};

describe('WebChatroomService Nearby-first assignment', () => {
  const service = new WebChatroomService({ getGun: jest.fn() } as any);

  it('places a confirmed first-time user into a small automatic Nearby room', async () => {
    const roomId = await service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, true);
    expect(isNearbyRoomId(roomId)).toBe(true);
  });

  it('does not publish a stranger room for an unconfirmed/GPS-less user', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, false),
    ).resolves.toBe(CONTACTS_ONLY_SCOPE_ID);
  });

  it('uses a Nearby room rather than a bottom-layer ~78 km tile', async () => {
    const roomId = await service.findOptimalChatroom(SAN_DIEGO);
    expect(isNearbyRoomId(roomId)).toBe(true);
    expect(roomId).not.toMatch(/^tile_/);
  });

  it('migrates an existing legacy room assignment into Nearby', async () => {
    const roomId = await service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', 'global', true);
    expect(isNearbyRoomId(roomId)).toBe(true);
  });

  it('preserves a deliberately selected Place across restart', async () => {
    await expect(service.findOptimalChatroomHierarchical(
      SAN_DIEGO,
      'user-1',
      'place_32.71_-117.17_0123456789ab',
      true,
    )).resolves.toBe('place_32.71_-117.17_0123456789ab');
  });

  it('honors Contacts-only before considering a saved Place', async () => {
    await expect(service.findOptimalChatroomHierarchical(
      SAN_DIEGO,
      'user-1',
      'place_32.71_-117.17_0123456789ab',
      true,
      'contacts-only',
    )).resolves.toBe(CONTACTS_ONLY_SCOPE_ID);
  });
});
