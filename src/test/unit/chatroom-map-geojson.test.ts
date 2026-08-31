import { chatroomsToGeoJson } from '../../shared/chatroom-map-geojson';

describe('chatroom map GeoJSON', () => {
  it('converts located rooms to point features with longitude-first coordinates', () => {
    const collection = chatroomsToGeoJson(
      [
        {
          id: 'coffee',
          name: 'Coffee discussion',
          icon: '☕',
          memberCount: 4,
          visitCount: 12,
          uniqueVisitorCount: 7,
          location: { latitude: 32.7157, longitude: -117.1611 },
        },
      ],
      'coffee',
    );

    expect(collection).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 'coffee',
          geometry: { type: 'Point', coordinates: [-117.1611, 32.7157] },
          properties: {
            chatroomId: 'coffee',
            name: 'Coffee discussion',
            icon: '☕',
            memberCount: 4,
            visitCount: 12,
            uniqueVisitorCount: 7,
            current: true,
          },
        },
      ],
    });
  });

  it('omits rooms without public coordinates and rejects invalid coordinates', () => {
    const collection = chatroomsToGeoJson([
      {
        id: 'private-room',
        name: 'Private room',
        icon: '💬',
        memberCount: 0,
        visitCount: 0,
        uniqueVisitorCount: 0,
      },
      {
        id: 'invalid-room',
        name: 'Invalid room',
        icon: '💬',
        memberCount: 0,
        visitCount: 0,
        uniqueVisitorCount: 0,
        location: { latitude: 91, longitude: 0 },
      },
    ]);

    expect(collection.features).toEqual([]);
  });
});
