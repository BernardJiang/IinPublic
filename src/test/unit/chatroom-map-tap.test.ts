import { routeMapTap } from '../../web/ui/chatroom-map-view';

const own = { west: -118, south: 32, east: -116, north: 34, approximateDiameterMeters: 200_000 };
const other = { id: 'nearby_v2_e1_aaaaaaaaaaaaaaaaaaaaaaaa', west: -122, south: 36, east: -120, north: 38, color: '#2563eb' };
const inner = { id: 'nearby_v2_e1_bbbbbbbbbbbbbbbbbbbbbbbb', west: -121.5, south: 36.5, east: -121, north: 37, color: '#9333ea' };

describe('map tap routing', () => {
  const options = { currentChatroom: 'nearby_v2_e1_926050112988aa94871fe00d', nearbyMapArea: own, otherRoomAreas: [other, inner] };

  it('keeps a tap inside my own room local (the traveler point card)', () => {
    expect(routeMapTap(options, 33, -117)).toEqual({ kind: 'inside-own-room' });
  });

  it('enters the other room whose square holds the tap, smallest square first', () => {
    expect(routeMapTap(options, 37.5, -120.5)).toEqual({ kind: 'enter-room', roomId: other.id });
    expect(routeMapTap(options, 36.7, -121.2)).toEqual({ kind: 'enter-room', roomId: inner.id });
  });

  it('travels to a point outside every room', () => {
    expect(routeMapTap(options, 40, -100)).toEqual({ kind: 'travel' });
  });

  it('has no own area inside a Place, so any tap moves', () => {
    expect(routeMapTap({ ...options, currentChatroom: 'place_babc' }, 33, -117)).toEqual({ kind: 'travel' });
  });
});
