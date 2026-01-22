import { GPSCoordinate, BlurredLocation } from './types';

/**
 * Location privacy utilities for IinPublic
 * Manages GPS coordinates and location blurring for privacy
 */
export class LocationPrivacy {

  /**
   * Blur a GPS coordinate to a region identifier
   * Uses grid-based blurring for consistent regional grouping
   */
  static blurLocation(coordinate: GPSCoordinate): BlurredLocation {
    // Convert to grid system (approximately 2km x 2km cells)
    const gridLat = Math.floor(coordinate.latitude * 100) / 100;
    const gridLon = Math.floor(coordinate.longitude * 100) / 100;
    
    // Create region identifier
    const region = `region_${gridLat}_${gridLon}`;
    
    return {
      region,
      chatrooms: [], // Will be populated by chatroom service
      trueLocation: coordinate // Only stored locally, never transmitted
    };
  }

  /**
   * Generate chatroom ID based on region and capacity
   * Splits regions when they get too crowded
   */
  static generateChatroomId(region: string, userCount: number): string {
    const maxUsersPerRoom = 50;
    const roomIndex = Math.floor(userCount / maxUsersPerRoom);
    return `${region}_room_${roomIndex}`;
  }

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  static calculateDistance(coord1: GPSCoordinate, coord2: GPSCoordinate): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = coord1.latitude * Math.PI / 180;
    const φ2 = coord2.latitude * Math.PI / 180;
    const Δφ = (coord2.latitude - coord1.latitude) * Math.PI / 180;
    const Δλ = (coord2.longitude - coord1.longitude) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }

  /**
   * Check if a location falls within a blurred region
   */
  static isInRegion(coordinate: GPSCoordinate, region: string): boolean {
    const blurred = this.blurLocation(coordinate);
    return blurred.region === region;
  }

  /**
   * Get nearby regions for expanded search
   */
  static getNearbyRegions(region: string, radius: number = 1): string[] {
    // Parse region coordinates
    const match = region.match(/region_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)/);
    if (!match) return [region];

    const [, latStr, lonStr] = match;
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    const regions: string[] = [region]; // Include current region

    // Add neighboring regions in a radius
    for (let i = -radius; i <= radius; i++) {
      for (let j = -radius; j <= radius; j++) {
        if (i === 0 && j === 0) continue; // Skip current region
        const newLat = (lat * 100 + i) / 100;
        const newLon = (lon * 100 + j) / 100;
        regions.push(`region_${newLat}_${newLon}`);
      }
    }

    return regions;
  }

  /**
   * Validate that no high-precision location data is being transmitted
   */
  static validatePrivacy(data: any): boolean {
    // Check for GPS coordinates in the data
    const gpsFields = ['latitude', 'longitude', 'coords', 'position', 'location'];
    const jsonStr = JSON.stringify(data);
    
    for (const field of gpsFields) {
      if (jsonStr.includes(field) && !jsonStr.includes('region_')) {
        return false; // High-precision location data found
      }
    }

    return true;
  }

  /**
   * Get mock location for development/testing
   */
  static getMockLocation(): GPSCoordinate {
    return {
      latitude: 40.7128, // New York City coordinates
      longitude: -74.0060,
      accuracy: 10,
      timestamp: new Date()
    };
  }

  /**
   * Get user's current location (platform-specific implementation needed)
   */
  static async getCurrentLocation(): Promise<GPSCoordinate> {
    // Check if we're in a browser environment
    if (typeof globalThis !== 'undefined' && 
        'navigator' in globalThis && 
        'geolocation' in (globalThis as any).navigator) {
      const nav = (globalThis as any).navigator;
      return new Promise((resolve, reject) => {
        nav.geolocation.getCurrentPosition(
          (position: any) => {
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: new Date()
            });
          },
          (error: any) => {
            reject(new Error(`Location error: ${error.message}`));
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          }
        );
      });
    }
    
    // Fallback to mock location for development
    return this.getMockLocation();
  }
}

export class ChatroomLocationManager {
  /**
   * Determine appropriate chatroom for a user based on location and capacity
   */
  static async findOptimalChatroom(
    location: BlurredLocation,
    _maxUsersPerRoom: number = 50
  ): Promise<string> {
    // Get current user count for the region
    const baseRoomId = `${location.region}_room_0`;
    
    // In a real implementation, this would query the database
    // For now, return the base room
    return baseRoomId;
  }

  /**
   * Handle chatroom splitting when capacity is exceeded
   */
  static async handleRoomSplit(
    chatroomId: string,
    currentUsers: string[]
  ): Promise<string[]> {
    const maxUsersPerRoom = 50;
    
    if (currentUsers.length <= maxUsersPerRoom) {
      return [chatroomId]; // No split needed
    }

    // Create new rooms
    const numRooms = Math.ceil(currentUsers.length / maxUsersPerRoom);
    const newRoomIds: string[] = [];
    
    const baseId = chatroomId.split('_room_')[0];
    
    for (let i = 0; i < numRooms; i++) {
      newRoomIds.push(`${baseId}_room_${i}`);
    }

    return newRoomIds;
  }

  /**
   * Merge chatrooms when occupancy is low
   */
  static async handleRoomMerge(
    region: string,
    _minUsersPerRoom: number = 10
  ): Promise<string> {
    // In a real implementation, this would query active rooms in the region
    // and merge them if they're under capacity
    
    return `${region}_room_0`; // Return primary room for the region
  }
}

/**
 * Location-based filtering utilities
 */
export class LocationFilter {
  /**
   * Filter users by proximity to a target location
   */
  static filterByProximity(
    users: Array<{ id: string; location: BlurredLocation }>,
    targetLocation: BlurredLocation,
    _maxDistance: number = 5000 // 5km default
  ): Array<{ id: string; location: BlurredLocation }> {
    return users.filter(user => {
      // For blurred locations, we can only check region proximity
      // In a real implementation, this would calculate approximate distances
      return user.location.region === targetLocation.region;
    });
  }

  /**
   * Get location-based conversation starters
   */
  static getLocationBasedPrompts(_location: BlurredLocation): string[] {
    // Extract general location info from region identifier
    const prompts = [
      "What's the best coffee shop around here?",
      "Any local events happening this weekend?",
      "Favorite restaurant in the area?",
      "Good spots for morning jogs nearby?",
      "Local hidden gems to share?"
    ];

    return prompts;
  }
}