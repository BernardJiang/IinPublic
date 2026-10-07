/** @jest-environment jsdom */

import { WebChatroomService } from '../../web/services/web-chatroom-service';
import type { GPSCoordinate } from '../../shared/types';

const SAN_DIEGO: GPSCoordinate = {
  latitude: 32.7157,
  longitude: -117.1611,
  accuracy: 10,
  timestamp: new Date('2026-10-06T12:00:00.000Z'),
};

describe('WebChatroomService automatic blurred-grid assignment', () => {
  const service = new WebChatroomService({ getGun: jest.fn() } as any);

  it('places a confirmed first-time user directly into the smallest blurred grid', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, true),
    ).resolves.toBe('region_32.71_-117.17_room_0');
  });

  it('does not derive a room from an unconfirmed placeholder location', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, false),
    ).resolves.toBe('global');
  });

  it('uses the blurred grid after a confirmed location refresh', async () => {
    await expect(service.findOptimalChatroom(SAN_DIEGO)).resolves.toBe(
      'region_32.71_-117.17_room_0',
    );
  });

  it('preserves an existing room assignment on re-entry', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', 'saved-room', true),
    ).resolves.toBe('saved-room');
  });
});
