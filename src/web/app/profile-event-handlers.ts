/** Profile/contact UI event composition, kept out of the application coordinator. */
import type { Tag, User } from '../../shared/types';
import { createSignedFriendMark } from '../../shared/friend-mark';
import { hasNoHubRoster } from '../../shared/nearby-rooms';
import type { BlockSignalEffects } from '../../core/block-signal-effects';
import type { WebGunService } from '../services/web-gun-service';
import type { WebUserService } from '../services/web-user-service';
import type { WebChatroomService } from '../services/web-chatroom-service';
import type { BlockStatusCache } from '../services/block-status-cache';
import { fetchWithTimeout } from '../services/fetch-with-timeout';
import { listP2PSessions } from '../services/p2p-webrtc-session';
import type { UIManager } from '../ui/ui-manager';

export interface ProfileEventHandlerDeps {
  ui: UIManager;
  users: WebUserService;
  gun: WebGunService;
  chatrooms: WebChatroomService;
  blockSignals: BlockSignalEffects;
  blockStatus: BlockStatusCache;
  currentUser(): User | undefined;
  setCurrentUser(user: User): void;
  writeCachedUser(user: User): void;
  refreshStatusBar(): void;
  refreshNearby(): void;
  currentRoomId(): string | undefined;
  backendApiBase(): string;
  renderSupportGreeting(): Promise<unknown>;
}

export function registerProfileEventHandlers(deps: ProfileEventHandlerDeps): void {
  const { ui, users, gun } = deps;

  ui.on('updateTalkFilters', async (filters: any) => {
    const user = deps.currentUser();
    if (!user) return;
    user.talkFilters = filters;
    deps.writeCachedUser(user);
    try {
      await users.updateTalkFilters(user.id, filters);
    } catch (error) {
      console.warn('Failed to persist talk filters:', error);
    }
  });

  ui.on('setCreditVisibility', async (data: { visible: boolean }) => {
    const user = deps.currentUser();
    if (!user) return;
    user.reputation.isHidden = !data.visible;
    try {
      await users.updateReputationVisibility(user.id, !data.visible);
    } catch (error) {
      console.warn('Failed to persist credit visibility:', error);
    }
  });

  ui.on(
    'saveKnownPerson',
    async (data: { userId: string; labels: any[]; nickname?: string; customLabel?: string; rating?: number; notes?: string }) => {
      const user = deps.currentUser();
      if (!user) return;
      try {
        const extras = {
          ...(data.customLabel ? { customLabel: data.customLabel } : {}),
          ...(typeof data.rating === 'number' ? { rating: data.rating } : {}),
          ...(data.notes ? { notes: data.notes } : {}),
        };
        const existing = user.knownPeople?.find((known) => known.userId === data.userId);
        const target = await users.getUser(data.userId);
        if (existing?.identityPub && target.pub && existing.identityPub !== target.pub) {
          throw new Error('Contact identity key changed; remove and verify the contact before adding again');
        }
        const liveIdentityPub = listP2PSessions()
          .find((session) => session.getOtherUserId() === data.userId)?.otherPub;
        const identityPub = existing?.identityPub ?? target.pub ?? liveIdentityPub;
        if (!identityPub) throw new Error('Cannot add Contact until the peer identity is verified');
        const identityEpub = existing?.identityEpub ?? target.epub;
        await users.addKnownPerson(user.id, data.userId, data.labels, data.nickname, {
          ...extras,
          identityPub,
          ...(identityEpub ? { identityEpub } : {}),
        });
        const pair = gun.getStoredPair();
        if (pair?.pub && pair?.priv && target.pub) {
          const friendMark = await createSignedFriendMark({
            markerUserId: user.id,
            targetUserId: data.userId,
            targetPub: target.pub,
            active: data.labels.includes('friend'),
            pair,
          });
          await users.setFriendMark(friendMark);
        }
        const currentEntry = user.knownPeople?.find((known) => known.userId === data.userId);
        if (currentEntry) {
          currentEntry.identityPub = identityPub;
          if (identityEpub) currentEntry.identityEpub = identityEpub;
          currentEntry.identityPinnedAt ??= new Date();
        }
        void deps.blockSignals.resendToContact({
          userId: data.userId,
          labels: data.labels,
          addedAt: new Date(),
          ...extras,
        }).catch((error) => console.warn('[BlockSignal] catch-up on saveKnownPerson failed:', error));
      } catch (error) {
        console.warn('Failed to save known person:', error);
      }
    },
  );

  ui.on('submitPeerReview', async (data: { userId: string; rating: number }) => {
    try {
      await users.submitPeerReview(data.userId, data.rating);
    } catch (error) {
      console.warn('Failed to submit peer review:', error);
    }
  });

  ui.on('vouchAgeVerified', async (data: { userId: string }) => {
    try {
      await users.vouchAgeVerified(data.userId);
      ui.showNotification(ui.formatAgeVoteSubmitted(), 'success');
    } catch (error) {
      console.warn('Failed to vouch age:', error);
    }
  });

  ui.on(
    'setUserBlocked',
    async (data: {
      userId: string;
      blocked: boolean;
      notify?: { groupId: string; recipientUserIds: string[] };
    }) => {
      const user = deps.currentUser();
      if (!user) return;
      try {
        const blockedUserIds = data.blocked
          ? await users.blockUser(user.id, data.userId)
          : await users.unblockUser(user.id, data.userId);
        deps.blockStatus.invalidate(data.userId);
        user.blockedUserIds = blockedUserIds;
        deps.writeCachedUser(user);
        ui.adoptSessionUser(user);
        ui.showNotification(ui.formatUserBlockChanged(data.blocked), 'success');
        if (data.blocked && data.notify) {
          const { groupId, recipientUserIds } = data.notify;
          void deps.blockSignals.fanOut(data.userId, groupId, recipientUserIds).catch((error) => {
            console.warn('[BlockSignal] fan-out failed:', error);
          });
        }
      } catch (error) {
        console.warn('Failed to update block state:', error);
      }
    },
  );

  ui.onStageNameChange = async (userId: string, newStageName: string) => {
    try {
      await users.updateStageName(userId, newStageName);
      const user = deps.currentUser();
      if (user?.id === userId) {
        user.stageName = newStageName;
        deps.writeCachedUser(user);
        ui.showMainInterface(user);
        deps.refreshStatusBar();
        deps.refreshNearby();
        const roomId = deps.currentRoomId();
        if (roomId && !hasNoHubRoster(roomId)) {
          gun.getGun().get('chatrooms').get(roomId).get('users').get(userId).put({
            stageName: newStageName,
          });
          deps.chatrooms.refreshMembershipStageName(roomId, userId, newStageName);
        }
        const pair = gun.getStoredPair();
        const published = { ...user };
        void (async () => {
          await users.syncPublicUserForRelay({
            ...published,
            ...(pair?.pub ? { pub: pair.pub } : {}),
            ...(pair?.epub ? { epub: pair.epub } : {}),
          });
          await deps.renderSupportGreeting();
          if (roomId && !hasNoHubRoster(roomId)) {
            await fetchWithTimeout(
              `${deps.backendApiBase()}/api/chatrooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stageName: newStageName, lastSeen: new Date().toISOString() }),
              },
            ).catch(() => undefined);
          }
        })().catch((error) => console.warn('Publishing the new stage name failed (kept locally):', error));
      }
      ui.showNotification(ui.formatStageNameUpdated(), 'success');
    } catch (error) {
      console.error('Failed to update stage name:', error);
      throw error;
    }
  };

  ui.onProfileChange = async (
    userId: string,
    updates: {
      headshot?: string;
      languages: string[];
      profile: Array<{ id: string; question: string; answer: string; isAuto: boolean; answeredAt: Date }>;
      interests: Tag[];
    },
  ) => {
    const previousUser = deps.currentUser();
    try {
      if (previousUser?.id === userId) {
        const applied: User = {
          ...previousUser,
          languages: updates.languages,
          profile: updates.profile,
          interests: updates.interests,
          ...(updates.headshot ? { headshot: updates.headshot } : {}),
        };
        if (!updates.headshot) delete (applied as Partial<User>).headshot;
        deps.setCurrentUser(applied);
        ui.showMainInterface(applied);
      }
      const updatedUser = await users.updateProfileFoundation(
        userId,
        updates,
        previousUser?.id === userId ? previousUser : undefined,
      );
      const currentUser = deps.currentUser();
      if (currentUser?.id === userId) {
        const merged: User = {
          ...currentUser,
          languages: updatedUser.languages,
          profile: updatedUser.profile,
          interests: updatedUser.interests,
          ...(updatedUser.headshot ? { headshot: updatedUser.headshot } : {}),
        };
        if (!updatedUser.headshot) delete (merged as Partial<User>).headshot;
        deps.setCurrentUser(merged);
        deps.writeCachedUser(merged);
        ui.showMainInterface(merged);
        deps.refreshStatusBar();
      }
      ui.showNotification(ui.formatProfileUpdated(), 'success');
    } catch (error) {
      console.error('Failed to update profile foundation:', error);
      if (previousUser && deps.currentUser()?.id === userId) {
        const restored: User = {
          ...deps.currentUser()!,
          languages: previousUser.languages,
          profile: previousUser.profile,
          interests: previousUser.interests,
          ...(previousUser.headshot ? { headshot: previousUser.headshot } : {}),
        };
        if (!previousUser.headshot) delete (restored as Partial<User>).headshot;
        deps.setCurrentUser(restored);
        ui.showMainInterface(restored);
      }
      throw error;
    }
  };
}
