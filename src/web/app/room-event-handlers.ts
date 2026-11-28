import { RoomSessionEffects, type RoomSessionState } from '../../core/room-session-effects';
import type { User } from '../../shared/types';
import type { WebChatroomService } from '../services/web-chatroom-service';
import type { UIManager } from '../ui/ui-manager';

export interface CustomRoomRequest {
  type: 'business' | 'custom';
  name: string;
  description?: string;
  businessInfo?: { headline?: string };
}

export interface RoomEventHandlerDeps {
  ui: UIManager;
  chatrooms: WebChatroomService;
  session: RoomSessionEffects;
  contactsOnlyRoomId: string;
  currentUser(): User | undefined;
  state(): RoomSessionState;
  commitState(state: RoomSessionState): void;
  persistRoom(roomId: string): void;
  persistTravel(): void;
  subscribeRoom(roomId: string): void;
  activateRoom(roomId: string): Promise<void>;
  isLocalOnly(roomId: string): boolean;
  refreshNearbyPoint(): void;
  syncBackgroundAgent(): void;
  resolveHomeRoom(): Promise<string>;
  updateLocation(): Promise<void>;
  locationConfirmed(): boolean;
  locationText(kind: 'refreshing' | 'refreshed'): string;
  requestLocationPermission(): Promise<void> | void;
  onLocationGranted(): Promise<void> | void;
  meetNewPeople(): Promise<void>;
  backToFirstGroup(): Promise<void>;
  beginNearbyTravel(point: { latitude: number; longitude: number }): void;
  createCustomRoom(payload: CustomRoomRequest): Promise<void>;
  notifySwitchFailed(user: User): void;
}

/** Owns room/location UI command registration and room-session transition ordering. */
export function registerRoomEventHandlers(deps: RoomEventHandlerDeps): void {
  const { ui, chatrooms } = deps;

  ui.on('requestLocationUpdate', async () => {
    ui.showNotification(deps.locationText('refreshing'), 'info');
    const before = deps.state().currentRoomId;
    try { await deps.updateLocation(); } catch { return; }
    const state = deps.state();
    if (deps.locationConfirmed() && !state.travelModeActive && state.currentRoomId === before) {
      ui.showNotification(deps.locationText('refreshed'), 'success');
    }
  });
  window.addEventListener('iinpublic-location-granted', () => { void deps.onLocationGranted(); });
  ui.on('requestLocationPermission', async () => { await deps.requestLocationPermission(); });
  ui.on('nearbyMeetNewPeople', () => { void deps.meetNewPeople().catch((error) => console.warn('Meet new people failed:', error)); });
  ui.on('nearbyBackToFirstGroup', () => { void deps.backToFirstGroup().catch((error) => console.warn('Back to group 1 failed:', error)); });
  ui.on('travelNearbyAtPoint', (point: { latitude: number; longitude: number }) => {
    const latitude = Number(point?.latitude);
    const longitude = Number(point?.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return;
    deps.beginNearbyTravel({ latitude, longitude });
  });

  ui.on('returnHomeFromTravel', async () => {
    const user = deps.currentUser();
    if (!user) return;
    const home = await deps.resolveHomeRoom();
    const before = deps.state().currentRoomId;
    const next = deps.session.home(deps.state(), home);
    deps.commitState({ ...next, currentRoomId: before });
    deps.persistTravel();
    ui.setTravelModeState({ active: false });
    deps.refreshNearbyPoint();
    if (before !== home) {
      await chatrooms.switchChatroom(user.id, home, user.stageName);
      deps.persistRoom(home);
      ui.setCurrentChatroomId(home);
      deps.subscribeRoom(home);
      if (!deps.isLocalOnly(home)) await deps.activateRoom(home);
    }
    deps.commitState(next);
    ui.showNotification(ui.formatTravelReturnedHome(), 'success');
    chatrooms.announceMembershipNow();
  });

  ui.on('createCustomChatroom', (payload: CustomRoomRequest) => deps.createCustomRoom(payload));

  ui.on('chatroomChanged', async (roomId: string) => {
    const user = deps.currentUser();
    if (!user) return;
    const state = deps.state();
    if (roomId === deps.contactsOnlyRoomId && state.currentRoomId && state.currentRoomId !== deps.contactsOnlyRoomId) {
      ui.showChatroomDetail(state.currentRoomId);
      return;
    }
    const previous = state.currentRoomId;
    if (previous !== roomId) {
      try {
        if (previous) {
          await chatrooms.switchChatroom(user.id, roomId, user.stageName);
        } else {
          const serviceRoom = chatrooms.getCurrentChatroomId();
          if (serviceRoom && serviceRoom !== roomId) await chatrooms.switchChatroom(user.id, roomId, user.stageName);
          else if (!serviceRoom) await chatrooms.joinChatroom(roomId, user.id, user.stageName);
        }
      } catch (error) {
        if (previous) ui.setCurrentChatroomId(previous);
        deps.notifySwitchFailed(user);
        if (state.pendingNearbyTravel) deps.commitState({ ...state, pendingNearbyTravel: undefined });
        console.warn(`Chatroom switch to ${roomId} was rejected:`, error);
        return;
      }
      deps.persistRoom(roomId);
    }
    const next = deps.session.enter(deps.state(), roomId);
    deps.commitState(next);
    ui.setCurrentChatroomId(roomId);
    ui.setTravelModeState({
      active: next.travelModeActive,
      ...(next.travelHomeRoomId ? { homeChatroomId: next.travelHomeRoomId } : {}),
    });
    deps.persistTravel();
    deps.refreshNearbyPoint();
    deps.subscribeRoom(roomId);
    if (!deps.isLocalOnly(roomId)) await deps.activateRoom(roomId);
    deps.syncBackgroundAgent();
  });
}
