/** @jest-environment jsdom */

import { WebChatroomService } from '../../web/services/web-chatroom-service';
import type { GPSCoordinate } from '../../shared/types';

const SAN_DIEGO: GPSCoordinate = {
  latitude: 32.7157,
  longitude: -117.1611,
  accuracy: 10,
  timestamp: new Date('2026-10-06T12:00:00.000Z'),
};

describe('WebChatroomService Global-first assignment', () => {
  const service = new WebChatroomService({ getGun: jest.fn() } as any);

  it('places a confirmed first-time user into Global to maximize early encounters', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, true),
    ).resolves.toBe('global');
  });

  it('also places an unconfirmed/GPS-less first-time user into Global', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', undefined, false),
    ).resolves.toBe('global');
  });

  it('uses the bottom-layer area tile (~78 km) after a confirmed location refresh', async () => {
    await expect(service.findOptimalChatroom(SAN_DIEGO)).resolves.toBe('tile_4_174_89');
  });

  it('preserves an existing room assignment on re-entry', async () => {
    await expect(
      service.findOptimalChatroomHierarchical(SAN_DIEGO, 'user-1', 'saved-room', true),
    ).resolves.toBe('saved-room');
  });
});
