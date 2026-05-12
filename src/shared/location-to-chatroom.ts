/**
 * Location to Chatroom Mapping
 * Maps GPS coordinates to hierarchical chatroom paths
 */

import { GPSCoordinate } from './types';
import { CHATROOM_HIERARCHY, ChatroomNode } from './chatroom-hierarchy';
import { LocationPrivacy } from './location';

/**
 * Get the hierarchical chatroom path for a location
 * Returns array from global → continental → country
 * Example: [' global', 'north-america', 'usa']
 */
export function getLocationChatroomPath(location: GPSCoordinate): string[] {
  const { latitude, longitude } = location;

  // Determine continent based on coordinates
  const continent = getContinentFromCoordinates(latitude, longitude);

  // Determine country based on coordinates
  const country = getCountryFromCoordinates(latitude, longitude);

  // Always start with global
  const path = ['global'];

  if (continent) {
    path.push(continent);
  }

  if (country) {
    path.push(country);
  }

  return path;
}

/**
 * Determine continent from GPS coordinates
 */
function getContinentFromCoordinates(lat: number, lon: number): string {
  // North America: roughly 15°N to 85°N, -170°W to -50°W
  if (lat >= 15 && lat <= 85 && lon >= -170 && lon <= -50) {
    return 'north-america';
  }

  // South America: roughly -55°S to 15°N, -80°W to -35°W
  if (lat >= -55 && lat <= 15 && lon >= -80 && lon <= -35) {
    return 'south-america';
  }

  // Europe: roughly 35°N to 70°N, -10°W to 40°E
  if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 40) {
    return 'europe';
  }

  // Asia: roughly 0°N to 80°N, 40°E to 180°E
  if (lat >= 0 && lat <= 80 && lon >= 40 && lon <= 180) {
    return 'asia';
  }

  // Africa: roughly -35°S to 35°N, -20°W to 50°E
  if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 50) {
    return 'africa';
  }

  // Oceania: roughly -50°S to 0°N, 110°E to 180°E
  if (lat >= -50 && lat <= 0 && lon >= 110 && lon <= 180) {
    return 'oceania';
  }

  // Default to global if no match
  return 'global';
}

/**
 * Determine country from GPS coordinates (simplified mapping)
 */
function getCountryFromCoordinates(lat: number, lon: number): string | null {
  // USA: roughly 25°N to 49°N, -125°W to -65°W
  if (lat >= 25 && lat <= 49 && lon >= -125 && lon <= -65) {
    return 'usa';
  }

  // Canada: roughly 42°N to 83°N, -141°W to -52°W
  if (lat >= 42 && lat <= 83 && lon >= -141 && lon <= -52) {
    return 'canada';
  }

  // Brazil: roughly -34°S to 5°N, -74°W to -35°W
  if (lat >= -34 && lat <= 5 && lon >= -74 && lon <= -35) {
    return 'brazil';
  }

  // Argentina: roughly -55°S to -22°S, -73°W to -53°W
  if (lat >= -55 && lat <= -22 && lon >= -73 && lon <= -53) {
    return 'argentina';
  }

  // UK: roughly 50°N to 59°N, -8°W to 2°E
  if (lat >= 50 && lat <= 59 && lon >= -8 && lon <= 2) {
    return 'uk';
  }

  // Germany: roughly 47°N to 55°N, 6°E to 15°E
  if (lat >= 47 && lat <= 55 && lon >= 6 && lon <= 15) {
    return 'germany';
  }

  // China: roughly 18°N to 54°N, 73°E to 135°E
  if (lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135) {
    return 'china';
  }

  // Japan: roughly 24°N to 46°N, 123°E to 146°E
  if (lat >= 24 && lat <= 46 && lon >= 123 && lon <= 146) {
    return 'japan';
  }

  // Nigeria: roughly 4°N to 14°N, 3°E to 15°E
  if (lat >= 4 && lat <= 14 && lon >= 3 && lon <= 15) {
    return 'nigeria';
  }

  // South Africa: roughly -35°S to -22°S, 16°E to 33°E
  if (lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33) {
    return 'south-africa';
  }

  // Australia: roughly -44°S to -10°S, 113°E to 154°E
  if (lat >= -44 && lat <= -10 && lon >= 113 && lon <= 154) {
    return 'australia';
  }

  // New Zealand: roughly -47°S to -34°S, 166°E to 179°E
  if (lat >= -47 && lat <= -34 && lon >= 166 && lon <= 179) {
    return 'new-zealand';
  }

  return null;
}

/**
 * Get the parent chatroom ID for a given chatroom
 * Returns null if already at global level
 */
export function getParentChatroom(chatroomId: string): string | null {
  if (chatroomId === 'global') {
    return null;
  }

  // Find the chatroom in the hierarchy
  let parent: string | null = null;

  function traverse(node: ChatroomNode, parentId: string | null): boolean {
    if (node.id === chatroomId) {
      parent = parentId;
      return true;
    }

    if (node.children) {
      for (const child of node.children) {
        if (traverse(child, node.id)) {
          return true;
        }
      }
    }

    return false;
  }

  traverse(CHATROOM_HIERARCHY, null);
  return parent;
}

/**
 * Find an appropriate child chatroom based on user's location
 * Used when bumping a user down from a full room
 */
export function findAppropriateChildChatroom(
  currentChatroomId: string,
  userLocation: GPSCoordinate,
): string | null {
  // Get the user's location path
  const locationPath = getLocationChatroomPath(userLocation);

  // Find the index of current chatroom in the path
  const currentIndex = locationPath.indexOf(currentChatroomId);

  // If not found, there is no safe hierarchy move.
  if (currentIndex === -1) {
    return null;
  }

  // If already at the smallest named hierarchy room, create a blurred regional room.
  if (currentIndex === locationPath.length - 1) {
    const blurred = LocationPrivacy.blurLocation(userLocation);
    return LocationPrivacy.generateChatroomId(blurred.region, 0);
  }

  // Return the next level down in the path
  return locationPath[currentIndex + 1];
}
