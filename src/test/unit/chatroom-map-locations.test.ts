import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import {
  CHATROOM_MAP_LOCATIONS,
  getChatroomMapLocation,
} from '../../shared/chatroom-map-locations';

describe('chatroom map locations', () => {
  it('maps every built-in leaf chatroom to a valid public room coordinate', () => {
    const leafRooms = getFlatChatroomList().filter((room) => !room.hasChildren);

    expect(leafRooms.length).toBeGreaterThan(0);
    expect(leafRooms.filter((room) => !getChatroomMapLocation(room.id))).toEqual([]);
    for (const room of leafRooms) {
      const point = getChatroomMapLocation(room.id)!;
      expect(point.latitude).toBeGreaterThanOrEqual(-90);
      expect(point.latitude).toBeLessThanOrEqual(90);
      expect(point.longitude).toBeGreaterThanOrEqual(-180);
      expect(point.longitude).toBeLessThanOrEqual(180);
    }
  });

  it('does not assign coordinates to hierarchy parents or arbitrary custom rooms', () => {
    expect(CHATROOM_MAP_LOCATIONS.global).toBeUndefined();
    expect(getChatroomMapLocation('custom-private-room')).toBeUndefined();
  });
});
