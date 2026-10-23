import type { User } from '../../shared/types';
import { TECHSUPPORT_ROOT_USER_ID } from '../../shared/techsupport';
import { roomCreationCredit, type RoomCreationCredit } from '../../shared/room-creation-credit';
import { CONFIG } from '../../shared/config';
import { escapeHtml } from './ui-formatters';
import { avatarInnerHtml } from './profile-avatar';
import {
  renderChatroomList as renderChatrooms,
  showChatroomDetail as openChatroomDetail,
  updateChatroomMembers as renderChatroomMembers,
  type CustomChatroomRow,
} from './chatrooms-view';
import { normalizeStringList, normalizeTalkFilterShape } from './settings-view';
import type { CustomChatroomDraft } from './custom-chatroom-dialogs';

import { createMapUserDots, type MapUserDotSource, type RoomMemberCardSource } from './chatroom-map-view';
import { filterProfileAttributesForViewer } from '../../shared/profile-privacy';
import type { QuestionAnswer } from '../../shared/types';
type ChatroomsViewDeps = Parameters<typeof renderChatrooms>[0];

export type ChatroomShellControllerDeps = {
  getApiBase: () => string;
  getCurrentChatroom: () => string;
  getCurrentUserId: () => string;
  getCurrentUser: () => User | undefined;
  getChatroomMemberCounts: () => ChatroomsViewDeps['chatroomMemberCounts'];
  getChatroomVisitCounts: () => ChatroomsViewDeps['chatroomVisitCounts'];
  getChatroomBrowseMode: () => ChatroomsViewDeps['chatroomBrowseMode'];
  getExpandedChatrooms: () => Set<string>;
  getMatchedUserIds: () => Set<string>;
  getCustomChatrooms: () => CustomChatroomRow[];
  getTravelModeActive: () => boolean;
  /** Group 2 supplies the network-backed model; Group 1 keeps a truthful one-group local shell. */
  setSessionUser: (user: User) => void;
  setCurrentUserId: (userId: string) => void;
  setChatroomBrowseMode: (mode: ChatroomsViewDeps['chatroomBrowseMode']) => void;
  setCurrentChatroom: (chatroomId: string) => void;
  setCurrentChatroomMembers: (members: Array<{ userId: string; stageName: string }>) => void;
  setChatroomsDetailRoomId: (chatroomId: string | null) => void;
  applyShellTranslations: () => void;
  renderSettingsView: (user: User) => void;
  displayAnswersList: () => void;
  syncReturnHomeButton: () => void;
  syncAppBarOverflow: () => void;
  openPeerDetail: (userId: string, stageName: string) => void;
  /** The peer's profile page (the map card's Profile button); Message uses openPeerDetail. */
  openPeerProfile?: (userId: string, stageName: string) => void;
  /** Public profile foundation (photo, languages, profile rows) for the map member card. */
  getPublicProfileFoundation?: (userId: string) => Promise<{ headshot?: string | null; languagesJson?: string; profileJson?: string } | null>;
  rememberPeerName: (userId: string, stageName: string) => void;
  showCreateCustomChatroomDialog: () => Promise<CustomChatroomDraft | null>;
  /** The creator's blurred ~1 km cell (`region_<lat>_<lng>`), or null without a confirmed GPS fix. */
  getAnchorCell?: () => string | null;
  upsertCustomChatroomFromServer: (row: CustomChatroomRow) => void;
  showNotification: (message: string, type: 'success' | 'error') => void;
  emit: (eventName: string, payload: unknown) => void;
  isUserOnline: (userId: string) => boolean;
  getCachedHeadshot?: (userId: string) => string | null;
  resolvePeerHeadshot?: (userId: string) => Promise<string | null>;
  formatDate: (date: Date) => string;
  t: (key: any) => string;
  tf: (key: any, values: Record<string, string | number>) => string;
};

export type ChatroomShellController = ReturnType<typeof createChatroomShellController>;

export function createChatroomShellController(deps: ChatroomShellControllerDeps) {
  /** Set by the app once Nearby runs: my point (★) and a loader for my list's dots and the heat. */
  let mapUserDotSource: MapUserDotSource | undefined;
  let roomMembers: ReadonlyArray<{ userId: string; stageName: string; isTraveler?: boolean }> = [];

  const parseList = <T>(json: string | undefined): T[] => {
    try {
      const parsed = JSON.parse(json || '[]');
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  };

  /** Green dot → who is it: name, presence, match, then photo/languages/public profile lines. */
  const roomMemberCard = (): RoomMemberCardSource => ({
    describe: (userId) => {
      const member = roomMembers.find((candidate) => candidate.userId === userId);
      return {
        stageName: member?.stageName || userId.slice(0, 8),
        online: deps.isUserOnline(userId),
        matched: deps.getMatchedUserIds().has(userId),
        traveler: member?.isTraveler === true,
      };
    },
    loadProfile: async (userId) => {
      const foundation = await deps.getPublicProfileFoundation?.(userId).catch(() => null);
      const headshot = foundation?.headshot ?? (await deps.resolvePeerHeadshot?.(userId).catch(() => null)) ?? null;
      if (!foundation && !headshot) return null;
      // Only rows any viewer may see; contacts-only and private rows never reach the map.
      const rows = filterProfileAttributesForViewer(parseList<QuestionAnswer>(foundation?.profileJson), { viewerIsContact: false });
      return {
        headshot,
        languages: parseList<string>(foundation?.languagesJson).filter((language) => typeof language === 'string'),
        highlights: rows
          .filter((row) => row && typeof row.question === 'string' && typeof row.answer === 'string' && row.answer.trim())
          .map((row) => `${row.question.trim()}: ${row.answer.trim()}`),
      };
    },
    message: deps.openPeerDetail,
    profile: (userId, stageName) => (deps.openPeerProfile ?? deps.openPeerDetail)(userId, stageName),
    text: {
      message: deps.t('mapMemberMessage'),
      profile: deps.t('mapMemberProfile'),
      online: deps.t('presenceOnline'),
      away: deps.t('presenceAway'),
      matched: deps.t('mapMemberMatched'),
      traveler: deps.t('chatroomTraveler'),
    },
  });
  let activeRooms: ChatroomsViewDeps['activeRooms'];
  let nearbyOnline: number | undefined;
  let nearbyBroadcastProgress: ChatroomsViewDeps['nearbyBroadcastProgress'];
  let nearbyGroup: ChatroomsViewDeps['nearbyGroup'];

  const viewDeps = (): ChatroomsViewDeps => {
    const mapUserDots = mapUserDotSource
      ? createMapUserDots(mapUserDotSource, deps.getCurrentUserId(), roomMembers, deps.t)
      : undefined;
    return {
      currentChatroom: deps.getCurrentChatroom(),
    chatroomMemberCounts: deps.getChatroomMemberCounts(),
    chatroomVisitCounts: deps.getChatroomVisitCounts(),
    chatroomBrowseMode: deps.getChatroomBrowseMode(),
    expandedChatrooms: deps.getExpandedChatrooms(),
    matchedUserIds: deps.getMatchedUserIds(),
    customChatrooms: deps.getCustomChatrooms(),
    travelModeActive: deps.getTravelModeActive(),
      ...(mapUserDots ? { mapUserDots, roomMemberCard: roomMemberCard() } : {}),
      ...(activeRooms ? { activeRooms } : {}),
      ...(nearbyOnline !== undefined ? { nearbyOnline } : {}),
      ...(nearbyBroadcastProgress ? { nearbyBroadcastProgress } : {}),
      ...(nearbyGroup ? { nearbyGroup } : {}),
      nearbyMembers: roomMembers,
    setChatroomBrowseMode: deps.setChatroomBrowseMode,
    setCurrentChatroom: (chatroomId) => {
      deps.setCurrentChatroom(chatroomId);
      deps.syncReturnHomeButton();
    },
    setCurrentChatroomMembers: deps.setCurrentChatroomMembers,
    escapeHtml,
    renderChatroomList: () => renderChatroomList(),
    openPeerDetail: deps.openPeerDetail,
    emit: deps.emit,
    currentUserId: deps.getCurrentUserId(),
    apiBase: deps.getApiBase(),
    text: deps.t,
    formatDate: deps.formatDate,
    isUserOnline: deps.isUserOnline,
    ...(deps.getCachedHeadshot ? { getCachedHeadshot: deps.getCachedHeadshot } : {}),
    ...(deps.resolvePeerHeadshot ? { resolvePeerHeadshot: deps.resolvePeerHeadshot } : {}),
      onChatroomDetailOpened: (chatroomId) => deps.setChatroomsDetailRoomId(chatroomId),
    };
  };

  const renderChatroomList = (): void => {
    renderChatrooms(viewDeps());
  };

  const showChatroomDetail = (chatroomId: string): void => {
    openChatroomDetail(viewDeps(), chatroomId);
    const createRoomButton = document.getElementById('create-custom-chatroom-btn');
    const broadcastButton = document.getElementById('broadcast-talk-btn');
    if (createRoomButton) createRoomButton.style.display = 'none';
    if (broadcastButton) broadcastButton.style.display = 'inline-flex';
    deps.syncReturnHomeButton();
    deps.syncAppBarOverflow();
  };

  const updateChatroomMembers = (
    members: Array<{ userId: string; stageName: string }>,
    currentUserId: string,
  ): void => {
    deps.setCurrentUserId(currentUserId);
    // Someone joined or left my room: refresh the room list so every headcount stays current.
    const memberKey = members.map((member) => member.userId).sort().join(',');
    if (memberKey !== roomMembers.map((member) => member.userId).sort().join(',')) deps.emit('activeRoomsRefresh', {});
    roomMembers = members;
    for (const member of members) {
      if (member.userId && member.stageName) deps.rememberPeerName(member.userId, member.stageName);
    }
    console.log(`📊 Updating member count for ${deps.getCurrentChatroom()}: ${members.length} total members`);
    renderChatroomMembers(viewDeps(), members, currentUserId);
  };

  const handleCreateCustomChatroomClick = async (): Promise<void> => {
    // The app layer owns signing and publication because the UI controller must never receive
    // the user's private key. A confirmed location is still required for the public map point.
    const anchorCell = deps.getAnchorCell?.() ?? null;
    if (!anchorCell) {
      deps.showNotification(deps.t('chatroomCreateNeedsLocation'), 'error');
      return;
    }
    // A Talk exchange may create a Contact, but only explicit incoming Friend marks build the
    // reputation needed to publish a Place. The hub repeats this check authoritatively.
    const currentUser = deps.getCurrentUser();
    let credit = roomCreationCredit(currentUser?.reputation, undefined, {
      minFriendMarks: CONFIG.PLACE_CREATE_MIN_FRIEND_MARKS,
      maxBlocksExclusive: CONFIG.PLACE_CREATE_MAX_BLOCKS_EXCLUSIVE,
    });
    if (currentUser?.id && currentUser.pub) {
      try {
        const response = await fetch(
          `${deps.getApiBase()}/api/users/${encodeURIComponent(currentUser.id)}/room-creation-credit?creatorPub=${encodeURIComponent(currentUser.pub)}`,
          { cache: 'no-store' },
        );
        const remote = await response.json() as Partial<RoomCreationCredit>;
        if (response.ok && typeof remote.eligible === 'boolean'
          && typeof remote.friendMarks === 'number' && typeof remote.blockCount === 'number'
          && typeof remote.requiredFriendMarks === 'number' && typeof remote.maximumAllowedBlocks === 'number'
          && typeof remote.enoughFriendMarks === 'boolean' && typeof remote.blockCountAllowed === 'boolean') {
          // The hub supplies authoritative counts. This client applies its own bundled threshold
          // to those counts, so an older/misconfigured lower-threshold hub cannot silently weaken
          // the release policy (and focused E2E can raise only the client threshold by URL).
          credit = roomCreationCredit(
            { friendsCount: remote.friendMarks, blockCount: remote.blockCount } as User['reputation'],
            remote.friendMarks,
            {
              minFriendMarks: CONFIG.PLACE_CREATE_MIN_FRIEND_MARKS,
              maxBlocksExclusive: CONFIG.PLACE_CREATE_MAX_BLOCKS_EXCLUSIVE,
            },
          );
          currentUser.reputation.friendsCount = credit.friendMarks;
          currentUser.reputation.blockCount = credit.blockCount;
        }
      } catch {
        // The signed create request repeats this check at the hub. Offline UI falls back to the
        // most recently synchronized public counters and remains fail-closed when they are low.
      }
    }
    if (!credit.eligible) {
      deps.showNotification(deps.tf('chatroomCreateNeedsCredit', {
        requiredFriends: credit.requiredFriendMarks,
        friends: credit.friendMarks,
        maximumBlocks: credit.maximumAllowedBlocks,
        blocks: credit.blockCount,
      }), 'error');
      return;
    }
    const payload = await deps.showCreateCustomChatroomDialog();
    if (!payload) return;
    deps.emit('createCustomChatroom', { ...payload, anchorCell });
  };

  const showChatroomList = (): void => {
    deps.setChatroomsDetailRoomId(null);
    const listContainer = document.getElementById('chatroom-list-container');
    const detailContainer = document.getElementById('chatroom-detail-container');
    if (listContainer) listContainer.style.display = 'flex';
    if (detailContainer) detailContainer.style.display = 'none';
    const backButton = document.getElementById('back-to-chatrooms') as HTMLElement | null;
    if (backButton) backButton.style.display = 'none';
    const createButton = document.getElementById('create-custom-chatroom-btn') as HTMLButtonElement | null;
    if (createButton) {
      createButton.style.display = 'inline-flex';
      createButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void handleCreateCustomChatroomClick();
      };
    }
    const broadcastButton = document.getElementById('broadcast-talk-btn');
    if (broadcastButton) broadcastButton.style.display = 'none';
    const ownerBar = document.getElementById('chatroom-owner-bar');
    if (ownerBar) {
      ownerBar.style.display = 'none';
      ownerBar.innerHTML = '';
    }
    const metadata = document.getElementById('chatroom-metadata');
    if (metadata) {
      metadata.style.display = 'none';
      metadata.innerHTML = '';
    }
    const headerTitle = document.getElementById('header-title');
    if (headerTitle) headerTitle.textContent = '';
    delete document.body.dataset.chatroomDetail;
    renderChatroomList();
    deps.syncReturnHomeButton();
    deps.syncAppBarOverflow();
  };

  const showMainInterface = (user: User): void => {
    user.languages = normalizeStringList(user.languages, ['en']).map((language) => language.toLowerCase());
    user.talkFilters = normalizeTalkFilterShape(user.talkFilters, user.languages);
    deps.setSessionUser(user);
    deps.applyShellTranslations();
    const headerStatus = document.getElementById('header-status');
    const headerUserInfo = document.getElementById('header-user-info');
    if (headerUserInfo) {
      const supportBadge = user.id === TECHSUPPORT_ROOT_USER_ID
        ? `<span class="techsupport-root-badge" data-testid="techsupport-root-badge">${escapeHtml(deps.t('techSupportRootBadge'))}</span>`
        : '';
      headerUserInfo.innerHTML = `
        <div class="user-avatar">
          ${avatarInnerHtml(user.headshot, user.stageName.charAt(0).toUpperCase(), escapeHtml)}
        </div>
        <span class="visually-hidden" data-testid="user-stage-name">${user.stageName}</span>
        ${supportBadge}`;
    }
    if (headerStatus) headerStatus.style.display = 'flex';
    // Settings is a large drill-down view. Building it while the startup Chatrooms panel is
    // visible delays the first useful input on slower WebViews for a screen the person may never
    // open. If Settings was selected before identity hydration completed, adoptSessionUser handles
    // that active-view case; otherwise the bottom-nav handler renders it on demand.
    if (document.getElementById('settings-view')?.classList.contains('active')) {
      deps.renderSettingsView(user);
    }
    deps.displayAnswersList();
    const chatroomInfo = document.getElementById('chatroom-info');
    if (chatroomInfo) {
      chatroomInfo.innerHTML = `
        <div class="chatroom-title">Global Chatroom</div>
        <div class="chatroom-status">Connected • Ready to meet people nearby</div>`;
    }
    const startupList = document.getElementById('chatroom-list');
    if (!startupList?.querySelector('.chatroom-item')) showChatroomList();
    else {
      deps.syncReturnHomeButton();
      deps.syncAppBarOverflow();
    }
  };

  /** The room list from the hub; re-render whichever chatroom view is showing. */
  const setActiveRooms = (view: NonNullable<ChatroomsViewDeps['activeRooms']>): void => {
    activeRooms = view;
    renderChatroomList();
  };

  const setNearbyOnline = (online: number): void => {
    if (online === nearbyOnline) return;
    nearbyOnline = online;
    renderChatroomList();
  };

  const setNearbyBroadcastProgress = (progress: ChatroomsViewDeps['nearbyBroadcastProgress'] | null): void => {
    nearbyBroadcastProgress = progress ?? undefined;
    renderChatroomList();
  };

  /** Kept for the next member render; the roster push that follows a group change re-renders. */
  const setNearbyGroup = (group: ChatroomsViewDeps['nearbyGroup'] | null): void => {
    nearbyGroup = group ?? undefined;
  };

  const setMapUserDotSource = (source: MapUserDotSource | null): void => {
    mapUserDotSource = source ?? undefined;
    if (deps.getChatroomBrowseMode() === 'map') renderChatroomList();
  };

  return {
    handleCreateCustomChatroomClick,
    setMapUserDotSource,
    setActiveRooms,
    setNearbyOnline,
    setNearbyBroadcastProgress,
    setNearbyGroup,
    renderChatroomList,
    showChatroomDetail,
    showChatroomList,
    showMainInterface,
    updateChatroomMembers,
  };
}
