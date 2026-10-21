import { parsePublicLocationRegion } from './public-location';
import { GPSCoordinate, BlurredLocation } from './types';

/**
 * Location privacy utilities for IinPublic
 * Manages GPS coordinates and location blurring for privacy
 */
/** A platform fix this recent is used without asking the WebView at all. */
export const NATIVE_FRESH_FIX_MS = 2 * 60_000;
/**
 * After the WebView's geolocation fails or times out, a platform fix this recent still counts: a
 * few hours old (blurred to at least ~1 km anyway) beats a random city. Indoors the P30 had only a
 * 5-hour-old fix and no network location provider (2026-10-20).
 */
export const NATIVE_FALLBACK_FIX_MS = 24 * 60 * 60_000;

/**
 * The Android app's own last-known fix (`IinPublicNearby.lastLocation()`, which also asks the GPS
 * for a fresh one), when it is at most `maxAgeMs` old; null in a browser or without a fix.
 */
export function nativeLastLocation(maxAgeMs: number, nowMs: number = Date.now()): GPSCoordinate | null {
  try {
    const bridge = (globalThis as { IinPublicNearby?: { lastLocation?: () => string } }).IinPublicNearby;
    if (typeof bridge?.lastLocation !== 'function') return null;
    const raw = bridge.lastLocation();
    if (!raw) return null;
    const fix = JSON.parse(raw) as { latitude?: unknown; longitude?: unknown; accuracy?: unknown; timeMs?: unknown };
    const latitude = Number(fix.latitude);
    const longitude = Number(fix.longitude);
    const timeMs = Number(fix.timeMs);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    if (!Number.isFinite(timeMs) || nowMs - timeMs > maxAgeMs) return null;
    const accuracy = Number(fix.accuracy);
    return { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : 1000, timestamp: new Date(timeMs) };
  } catch {
    return null;
  }
}

export class LocationPrivacy {

  /**
   * Snap a coordinate to the ~2km x 2km privacy grid. Shared by `blurLocation` (region id)
   * and `blurCoordinatePair` (numeric pair) so both ever expose the same coarse precision.
   */
  private static gridSnap(coordinate: GPSCoordinate): { latitude: number; longitude: number } {
    return {
      latitude: Math.floor(coordinate.latitude * 100) / 100,
      longitude: Math.floor(coordinate.longitude * 100) / 100,
    };
  }

  /**
   * Blur a GPS coordinate to a region identifier
   * Uses grid-based blurring for consistent regional grouping
   */
  static blurLocation(coordinate: GPSCoordinate): BlurredLocation {
    const { latitude: gridLat, longitude: gridLon } = this.gridSnap(coordinate);

    // Create region identifier
    const region = `region_${gridLat}_${gridLon}`;

    return {
      region,
      chatrooms: [], // Will be populated by chatroom service
    };
  }

  /**
   * Strip legacy/private fields before a location object is written to any shared graph. Older
   * clients embedded `trueLocation` in `BlurredLocation`; accepting that shape at runtime is
   * necessary for migration, but republishing it is not.
   */
  static sanitizeBlurredLocation(location: Partial<BlurredLocation> | null | undefined): BlurredLocation {
    return {
      region: typeof location?.region === 'string' ? location.region : '',
      chatrooms: Array.isArray(location?.chatrooms)
        ? [...new Set(location.chatrooms.map(String).filter(Boolean))]
        : [],
    };
  }

  /**
   * Approximate centre of a public blurred grid. This preserves distance sorting/filtering without
   * recovering or publishing a device's exact GPS fix.
   */
  static coordinateFromRegion(region: string): GPSCoordinate | null {
    // Current form (public-location.ts): the exact public square centre and its size.
    const cell = parsePublicLocationRegion(region);
    if (cell) {
      return { latitude: cell.latitude, longitude: cell.longitude, accuracy: cell.precisionMeters, timestamp: new Date(0) };
    }
    const match = /^region_(-?\d+(?:\.\d+)?)_(-?\d+(?:\.\d+)?)$/.exec(String(region || ''));
    if (!match) return null;
    const latitude = Math.round((Number(match[1]) + 0.005) * 1_000_000) / 1_000_000;
    const longitude = Math.round((Number(match[2]) + 0.005) * 1_000_000) / 1_000_000;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      // Half the diagonal of a 0.01-degree cell is roughly 0.8 km at the equator. Round upward
      // because longitude scale and GPS uncertainty vary, and callers must treat this as coarse.
      accuracy: 1_000,
      timestamp: new Date(0),
    };
  }

  /**
   * Blur a GPS coordinate to the same ~2km grid as `blurLocation`, but returns a plain
   * `{latitude, longitude}` pair instead of a region string — for fields (like
   * `Talk.authorLocation`) that need to stay numeric for existing distance-filter consumers
   * (`haversineMilesBetween` et al.) without inventing a second, string-only representation.
   */
  static blurCoordinatePair(coordinate: GPSCoordinate): { latitude: number; longitude: number } {
    return this.gridSnap(coordinate);
  }

  /**
   * Generate the regional chatroom ID. Overflow is handled by FIFO eviction down the room
   * hierarchy (CONFIG.CHATROOM_MAX_CAPACITY), not by numbered `_room_N` splits.
   */
  static generateChatroomId(region: string): string {
    return `${region}_room_0`;
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
      // Android app: the platform's own fix, when it is recent, answers at once. The WebView's
      // geolocation goes through Google Play services, which on the Huawei P30 never answered while
      // the phone's GPS had a 5 m fix (2026-10-20); it stays the first choice otherwise.
      const fresh = nativeLastLocation(NATIVE_FRESH_FIX_MS);
      if (fresh) return fresh;
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
            // A slow or failed WebView fix: take the platform's, if it has a reasonably recent one.
            const fallback = error?.code !== 1 ? nativeLastLocation(NATIVE_FALLBACK_FIX_MS) : null;
            if (fallback) {
              resolve(fallback);
              return;
            }
            // Keep the GeolocationPositionError code: 1 (PERMISSION_DENIED) means a saved fix can
            // no longer be refreshed, which callers treat differently from a slow or failed fix.
            reject(Object.assign(new Error(`Location error: ${error.message}`), { code: error?.code }));
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
  ): Promise<string> {
    // Get current user count for the region
    const baseRoomId = `${location.region}_room_0`;
    
    // In a real implementation, this would query the database
    // For now, return the base room
    return baseRoomId;
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
