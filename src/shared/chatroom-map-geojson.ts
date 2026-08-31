import type { ChatroomMapLocation } from './chatroom-map-locations';

export type ChatroomMapFeatureInput = Readonly<{
  id: string;
  name: string;
  icon: string;
  memberCount: number;
  visitCount: number;
  uniqueVisitorCount: number;
  location?: ChatroomMapLocation;
}>;

export type ChatroomMapFeatureProperties = {
  chatroomId: string;
  name: string;
  icon: string;
  memberCount: number;
  visitCount: number;
  uniqueVisitorCount: number;
  current: boolean;
};

export type ChatroomMapPointFeature = {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: ChatroomMapFeatureProperties;
};

export type ChatroomMapFeatureCollection = {
  type: 'FeatureCollection';
  features: ChatroomMapPointFeature[];
};

export function isValidChatroomMapLocation(value: unknown): value is ChatroomMapLocation {
  if (!value || typeof value !== 'object') return false;
  const point = value as { latitude?: unknown; longitude?: unknown };
  return (
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

/** Build the clustered MapLibre source without accepting or exposing user coordinates. */
export function chatroomsToGeoJson(
  rooms: ReadonlyArray<ChatroomMapFeatureInput>,
  currentChatroom = '',
): ChatroomMapFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rooms.flatMap((room): ChatroomMapPointFeature[] => {
      if (!isValidChatroomMapLocation(room.location)) return [];
      return [
        {
          type: 'Feature',
          id: room.id,
          geometry: {
            type: 'Point',
            // GeoJSON coordinates are longitude first.
            coordinates: [room.location.longitude, room.location.latitude],
          },
          properties: {
            chatroomId: room.id,
            name: room.name,
            icon: room.icon,
            memberCount: room.memberCount,
            visitCount: room.visitCount,
            uniqueVisitorCount: room.uniqueVisitorCount,
            current: room.id === currentChatroom,
          },
        },
      ];
    }),
  };
}
