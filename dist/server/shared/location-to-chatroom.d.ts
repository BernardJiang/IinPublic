/**
 * Location to Chatroom Mapping
 * Maps GPS coordinates to hierarchical chatroom paths
 */
import { GPSCoordinate } from './types';
/**
 * Get the hierarchical chatroom path for a location
 * Returns array from global → continental → country
 * Example: [' global', 'north-america', 'usa']
 */
export declare function getLocationChatroomPath(location: GPSCoordinate): string[];
/**
 * Get the parent chatroom ID for a given chatroom
 * Returns null if already at global level
 */
export declare function getParentChatroom(chatroomId: string): string | null;
/**
 * Find an appropriate child chatroom based on user's location
 * Used when bumping a user down from a full room
 */
export declare function findAppropriateChildChatroom(currentChatroomId: string, userLocation: GPSCoordinate): string | null;
//# sourceMappingURL=location-to-chatroom.d.ts.map