import { LocationPrivacy, ChatroomLocationManager, LocationFilter } from '../../shared/location';
import { GPSCoordinate, BlurredLocation } from '../../shared/types';

describe('LocationPrivacy', () => {
  describe('blurLocation', () => {
    it('should blur GPS coordinates to a region', () => {
      const coordinate: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const blurred = LocationPrivacy.blurLocation(coordinate);

      expect(blurred.region).toMatch(/^region_40\.71_-74\.01$/);
      expect(blurred.chatrooms).toEqual([]);
      expect(blurred.trueLocation).toEqual(coordinate);
    });

    it('should consistently blur similar coordinates to the same region', () => {
      const coord1: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const coord2: GPSCoordinate = {
        latitude: 40.7129, // Slight difference
        longitude: -74.0061,
        accuracy: 10,
        timestamp: new Date(),
      };

      const blurred1 = LocationPrivacy.blurLocation(coord1);
      const blurred2 = LocationPrivacy.blurLocation(coord2);

      expect(blurred1.region).toBe(blurred2.region);
    });
  });

  describe('blurCoordinatePair (docs/TODO.md §X)', () => {
    it('snaps to the same grid as blurLocation, returned as a numeric pair', () => {
      const coordinate: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const pair = LocationPrivacy.blurCoordinatePair(coordinate);

      expect(pair).toEqual({ latitude: 40.71, longitude: -74.01 });
      // Same grid cell as blurLocation's region string, just numeric instead of a string —
      // existing consumers (haversineMilesBetween, cid.ts's includeLocation) need no changes.
      expect(LocationPrivacy.blurLocation(coordinate).region).toBe('region_40.71_-74.01');
    });

    it('never returns the precise coordinate', () => {
      const coordinate: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const pair = LocationPrivacy.blurCoordinatePair(coordinate);

      expect(pair.latitude).not.toBe(coordinate.latitude);
      expect(pair.longitude).not.toBe(coordinate.longitude);
    });

    it('consistently blurs nearby coordinates to the same pair', () => {
      const coord1: GPSCoordinate = { latitude: 40.7128, longitude: -74.006, accuracy: 10, timestamp: new Date() };
      const coord2: GPSCoordinate = { latitude: 40.7129, longitude: -74.0061, accuracy: 10, timestamp: new Date() };

      expect(LocationPrivacy.blurCoordinatePair(coord1)).toEqual(LocationPrivacy.blurCoordinatePair(coord2));
    });
  });

  describe('calculateDistance', () => {
    it('should calculate distance between two coordinates', () => {
      const coord1: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const coord2: GPSCoordinate = {
        latitude: 40.7589,
        longitude: -73.9851,
        accuracy: 10,
        timestamp: new Date(),
      };

      const distance = LocationPrivacy.calculateDistance(coord1, coord2);

      // Distance between these NYC coordinates should be around 6-7km
      expect(distance).toBeGreaterThan(5000);
      expect(distance).toBeLessThan(8000);
    });

    it('should return 0 for identical coordinates', () => {
      const coord: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const distance = LocationPrivacy.calculateDistance(coord, coord);
      expect(distance).toBe(0);
    });
  });

  describe('isInRegion', () => {
    it('should correctly identify if coordinate is in region', () => {
      const coordinate: GPSCoordinate = {
        latitude: 40.7128,
        longitude: -74.006,
        accuracy: 10,
        timestamp: new Date(),
      };

      const region = 'region_40.71_-74.01';
      expect(LocationPrivacy.isInRegion(coordinate, region)).toBe(true);

      const differentRegion = 'region_41.00_-74.00';
      expect(LocationPrivacy.isInRegion(coordinate, differentRegion)).toBe(false);
    });
  });

  describe('getNearbyRegions', () => {
    it('should return nearby regions including the center', () => {
      const region = 'region_40.71_-74.00';
      const nearbyRegions = LocationPrivacy.getNearbyRegions(region, 1);

      expect(nearbyRegions).toContain(region);
      expect(nearbyRegions.length).toBe(9); // 3x3 grid

      // Check that surrounding regions are included
      expect(nearbyRegions).toContain('region_40.7_-74.01');
      expect(nearbyRegions).toContain('region_40.72_-73.99');
    });

    it('should handle invalid region format', () => {
      const invalidRegion = 'invalid-region';
      const nearbyRegions = LocationPrivacy.getNearbyRegions(invalidRegion);

      expect(nearbyRegions).toEqual([invalidRegion]);
    });
  });

  describe('validatePrivacy', () => {
    it('should pass for data without GPS coordinates', () => {
      const safeData = {
        message: 'Hello world',
        timestamp: new Date(),
        userId: '12345',
      };

      expect(LocationPrivacy.validatePrivacy(safeData)).toBe(true);
    });

    it('should pass for data with region identifiers', () => {
      const regionData = {
        location: {
          region: 'region_40.71_-74.00',
          chatrooms: ['room1', 'room2'],
        },
      };

      expect(LocationPrivacy.validatePrivacy(regionData)).toBe(true);
    });

    it('should fail for data with GPS coordinates', () => {
      const unsafeData = {
        latitude: 40.7128,
        longitude: -74.006,
        message: 'Hello',
      };

      expect(LocationPrivacy.validatePrivacy(unsafeData)).toBe(false);
    });
  });

  describe('generateChatroomId', () => {
    it('should generate correct chatroom ID based on user count', () => {
      const region = 'region_40.71_-74.00';

      expect(LocationPrivacy.generateChatroomId(region, 25)).toBe('region_40.71_-74.00_room_0');
      expect(LocationPrivacy.generateChatroomId(region, 75)).toBe('region_40.71_-74.00_room_1');
      expect(LocationPrivacy.generateChatroomId(region, 125)).toBe('region_40.71_-74.00_room_2');
    });
  });

  describe('getCurrentLocation', () => {
    it('should return mock location in test environment', async () => {
      const location = await LocationPrivacy.getCurrentLocation();

      expect(location).toBeDefined();
      // Coordinates come from the jest setup.ts geolocation mock (New York)
      expect(location.latitude).toBe(40.7128);
      expect(location.longitude).toBe(-74.006);
      expect(location.accuracy).toBe(10);
      expect(location.timestamp).toBeInstanceOf(Date);
    });
  });
});

describe('ChatroomLocationManager', () => {
  describe('findOptimalChatroom', () => {
    it('should return base chatroom for a region', async () => {
      const location: BlurredLocation = {
        region: 'region_40.71_-74.00',
        chatrooms: [],
      };

      const chatroomId = await ChatroomLocationManager.findOptimalChatroom(location);
      expect(chatroomId).toBe('region_40.71_-74.00_room_0');
    });
  });

  describe('handleRoomSplit', () => {
    it('should not split room with few users', async () => {
      const chatroomId = 'region_40.71_-74.00_room_0';
      const users = Array.from({ length: 30 }, (_, i) => `user${i}`);

      const result = await ChatroomLocationManager.handleRoomSplit(chatroomId, users);
      expect(result).toEqual([chatroomId]);
    });

    it('should split room with too many users', async () => {
      const chatroomId = 'region_40.71_-74.00_room_0';
      const users = Array.from({ length: 75 }, (_, i) => `user${i}`);

      const result = await ChatroomLocationManager.handleRoomSplit(chatroomId, users);
      expect(result).toHaveLength(2);
      expect(result).toContain('region_40.71_-74.00_room_0');
      expect(result).toContain('region_40.71_-74.00_room_1');
    });
  });

  describe('handleRoomMerge', () => {
    it('should return primary room for region', async () => {
      const region = 'region_40.71_-74.00';
      const result = await ChatroomLocationManager.handleRoomMerge(region, 10);

      expect(result).toBe('region_40.71_-74.00_room_0');
    });
  });
});

describe('LocationFilter', () => {
  describe('filterByProximity', () => {
    it('should filter users by same region', () => {
      const users = [
        { id: 'user1', location: { region: 'region_40.71_-74.00', chatrooms: [] } },
        { id: 'user2', location: { region: 'region_40.71_-74.00', chatrooms: [] } },
        { id: 'user3', location: { region: 'region_41.00_-74.00', chatrooms: [] } },
      ];

      const targetLocation: BlurredLocation = {
        region: 'region_40.71_-74.00',
        chatrooms: [],
      };

      const filtered = LocationFilter.filterByProximity(users, targetLocation);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((u) => u.id)).toEqual(['user1', 'user2']);
    });
  });

  describe('getLocationBasedPrompts', () => {
    it('should return location-appropriate prompts', () => {
      const location: BlurredLocation = {
        region: 'region_40.71_-74.00',
        chatrooms: [],
      };

      const prompts = LocationFilter.getLocationBasedPrompts(location);

      expect(prompts).toBeDefined();
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts.every((prompt) => typeof prompt === 'string')).toBe(true);
    });
  });
});
