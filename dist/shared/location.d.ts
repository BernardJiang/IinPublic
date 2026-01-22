import { GPSCoordinate, BlurredLocation } from './types';
/**
 * Location privacy utilities for IinPublic
 * Manages GPS coordinates and location blurring for privacy
 */
export declare class LocationPrivacy {
    /**
     * Blur a GPS coordinate to a region identifier
     * Uses grid-based blurring for consistent regional grouping
     */
    static blurLocation(coordinate: GPSCoordinate): BlurredLocation;
    /**
     * Generate chatroom ID based on region and capacity
     * Splits regions when they get too crowded
     */
    static generateChatroomId(region: string, userCount: number): string;
    /**
     * Calculate distance between two coordinates (Haversine formula)
     */
    static calculateDistance(coord1: GPSCoordinate, coord2: GPSCoordinate): number;
    /**
     * Check if a location falls within a blurred region
     */
    static isInRegion(coordinate: GPSCoordinate, region: string): boolean;
    /**
     * Get nearby regions for expanded search
     */
    static getNearbyRegions(region: string, radius?: number): string[];
    /**
     * Validate that no high-precision location data is being transmitted
     */
    static validatePrivacy(data: any): boolean;
    /**
     * Get mock location for development/testing
     */
    static getMockLocation(): GPSCoordinate;
    /**
     * Get user's current location (platform-specific implementation needed)
     */
    static getCurrentLocation(): Promise<GPSCoordinate>;
}
export declare class ChatroomLocationManager {
    /**
     * Determine appropriate chatroom for a user based on location and capacity
     */
    static findOptimalChatroom(location: BlurredLocation, _maxUsersPerRoom?: number): Promise<string>;
    /**
     * Handle chatroom splitting when capacity is exceeded
     */
    static handleRoomSplit(chatroomId: string, currentUsers: string[]): Promise<string[]>;
    /**
     * Merge chatrooms when occupancy is low
     */
    static handleRoomMerge(region: string, _minUsersPerRoom?: number): Promise<string>;
}
/**
 * Location-based filtering utilities
 */
export declare class LocationFilter {
    /**
     * Filter users by proximity to a target location
     */
    static filterByProximity(users: Array<{
        id: string;
        location: BlurredLocation;
    }>, targetLocation: BlurredLocation, _maxDistance?: number): Array<{
        id: string;
        location: BlurredLocation;
    }>;
    /**
     * Get location-based conversation starters
     */
    static getLocationBasedPrompts(_location: BlurredLocation): string[];
}
//# sourceMappingURL=location.d.ts.map