import type { GPSCoordinate } from '../shared/types';

export interface NearbyTravelRequest {
  location: GPSCoordinate;
  placeId: string;
  placeName: string;
}

export interface RoomSessionState {
  currentRoomId: string | undefined;
  travelModeActive: boolean;
  travelHomeRoomId: string | undefined;
  travelRoomId: string | undefined;
  travelNearbyPoint: (GPSCoordinate & { placeId: string; placeName: string }) | undefined;
  pendingNearbyTravel: NearbyTravelRequest | undefined;
}

export interface RoomKindPort {
  isNearby(roomId: string): boolean;
  isPlace(roomId: string): boolean;
}

/** Pure room/travel state transitions shared by browser and native-backed hosts. */
export class RoomSessionEffects {
  constructor(private readonly kinds: RoomKindPort) {}

  enter(state: RoomSessionState, roomId: string): RoomSessionState {
    const previousRoomId = state.currentRoomId;
    const nearbyRequest = state.pendingNearbyTravel && this.kinds.isNearby(roomId)
      ? state.pendingNearbyTravel
      : undefined;
    const continuingNearby = state.travelModeActive
      && state.travelNearbyPoint != null
      && this.kinds.isNearby(roomId);
    if (nearbyRequest || continuingNearby) {
      return {
        ...state,
        currentRoomId: roomId,
        travelModeActive: true,
        travelHomeRoomId: !state.travelModeActive && previousRoomId && !this.kinds.isPlace(previousRoomId)
          ? previousRoomId
          : state.travelHomeRoomId,
        travelRoomId: roomId,
        travelNearbyPoint: nearbyRequest
          ? { ...nearbyRequest.location, placeId: nearbyRequest.placeId, placeName: nearbyRequest.placeName }
          : state.travelNearbyPoint,
        pendingNearbyTravel: undefined,
      };
    }
    if (this.kinds.isPlace(roomId)) {
      return {
        ...state,
        currentRoomId: roomId,
        travelModeActive: true,
        travelHomeRoomId: !state.travelModeActive && previousRoomId && !this.kinds.isPlace(previousRoomId)
          ? previousRoomId
          : state.travelHomeRoomId,
        travelRoomId: roomId,
        travelNearbyPoint: undefined,
        pendingNearbyTravel: undefined,
      };
    }
    return {
      ...state,
      currentRoomId: roomId,
      travelModeActive: false,
      travelHomeRoomId: roomId,
      travelRoomId: undefined,
      travelNearbyPoint: undefined,
      pendingNearbyTravel: undefined,
    };
  }

  home(state: RoomSessionState, roomId: string): RoomSessionState {
    return {
      ...state,
      currentRoomId: roomId,
      travelModeActive: false,
      travelHomeRoomId: roomId,
      travelRoomId: undefined,
      travelNearbyPoint: undefined,
      pendingNearbyTravel: undefined,
    };
  }
}
