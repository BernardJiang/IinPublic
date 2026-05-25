import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';
import type { PeerRelationshipStats } from '../../server/routes/peer-routes';
import type { UiTranslationKey } from './ui-translations';

type ChatroomMember = { userId: string; stageName: string };

export type CustomChatroomRow = {
  id: string;
  name: string;
  type: string;
  description?: string;
  createdBy?: string;
};

type ChatroomsViewDeps = {
  currentChatroom: string;
  chatroomMemberCounts: Map<string, number>;
  chatroomVisitCounts: Map<string, { visitCount: number; uniqueVisitorCount: number }>;
  expandedChatrooms: Set<string>;
  matchedUserIds: Set<string>;
  customChatrooms: ReadonlyArray<CustomChatroomRow>;
  setCurrentChatroom: (chatroomId: string) => void;
  setCurrentChatroomMembers: (members: ChatroomMember[]) => void;
  escapeHtml: (text: string) => string;
  renderChatroomList: () => void;
  openPeerDetail: (userId: string, stageName: string) => void;
  emit: (eventName: string, payload: unknown) => void;
  currentUserId: string;
  apiBase: string;
  text: (key: UiTranslationKey) => string;
};

export function syncStatusBroadcastButtonVisibility(currentChatroom: string): void {
  const button = document.getElementById('broadcast-talk-btn') as HTMLButtonElement | null;
  if (!button) return;
  button.disabled = !currentChatroom;
}

function hierarchyIds(): Set<string> {
  return new Set(getFlatChatroomList().map((r) => r.id));
}

function customRoomIcon(type: string): string {
  return type === 'business' ? '🏪' : '💬';
}

function formatMetrics(
  deps: ChatroomsViewDeps,
  memberCount: number,
  visits: { visitCount: number; uniqueVisitorCount: number },
): string {
  const formatCount = (count: number, singular: UiTranslationKey, plural: UiTranslationKey): string =>
    deps.text(count === 1 ? singular : plural).replace('{count}', String(count));

  return deps.text('chatroomMetrics')
    .replace('{members}', formatCount(memberCount, 'chatroomMemberOne', 'chatroomMembers'))
    .replace('{visits}', formatCount(visits.visitCount, 'chatroomVisitOne', 'chatroomVisits'))
    .replace('{unique}', formatCount(visits.uniqueVisitorCount, 'chatroomUniqueOne', 'chatroomUniqueVisitors'));
}

export function renderChatroomList(deps: ChatroomsViewDeps): void {
  const allChatrooms = getFlatChatroomList();

  if (deps.currentChatroom && !allChatrooms.find((room) => room.id === deps.currentChatroom)) {
    const customFallback = deps.customChatrooms.find((c) => c.id === deps.currentChatroom);
    allChatrooms.unshift({
      id: deps.currentChatroom,
      name: customFallback?.name || 'My Location',
      icon: customFallback ? customRoomIcon(customFallback.type) : '📍',
      level: 0,
      description: customFallback?.description || 'Your current location chatroom',
      hasChildren: false,
    });
  }

  const visibleChatrooms = allChatrooms.filter((room) => {
    if (room.level === 0) return true;
    if (room.parentId) {
      return deps.expandedChatrooms.has(room.parentId);
    }
    return true;
  });

  const skipCustom = hierarchyIds();
  const customNodes = deps.customChatrooms
    .filter((c) => c.id && !skipCustom.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      icon: customRoomIcon(c.type),
      level: 0,
      description: c.description || '',
      hasChildren: false as const,
    }));

  const rows = [...visibleChatrooms, ...customNodes];

  const chatroomList = document.getElementById('chatroom-list');
  if (!chatroomList) return;

  chatroomList.innerHTML = rows
    .map((room) => {
      const memberCount = deps.chatroomMemberCounts.get(room.id) || 0;
      const visitCounts = deps.chatroomVisitCounts.get(room.id) || { visitCount: 0, uniqueVisitorCount: 0 };
      const isCurrentRoom = deps.currentChatroom === room.id;
      const isExpanded = deps.expandedChatrooms.has(room.id);
      const expandIcon = room.hasChildren ? (isExpanded ? '▼' : '▶') : '';

      return `
        <div class="chatroom-item ${isCurrentRoom ? 'current-room' : ''}" 
             data-chatroom-id="${room.id}" 
             data-level="${room.level}"
             data-has-children="${room.hasChildren}"
             style="padding-left: ${room.level * 20 + 16}px;">
          ${room.hasChildren ? `<div class="chatroom-expand-icon" data-chatroom-id="${room.id}">${expandIcon}</div>` : '<div class="chatroom-expand-icon-placeholder"></div>'}
          <div class="chatroom-icon">${room.icon}</div>
          <div class="chatroom-info">
            <div class="chatroom-name">
              ${room.name}
              ${isCurrentRoom ? `<span class="current-room-badge">${deps.text('chatroomCurrent')}</span>` : ''}
              <span class="chatroom-headcount">${memberCount > 0 ? `👥 ${memberCount}` : '👥 0'}</span>
              <span class="chatroom-visitcount">🚪 ${visitCounts.visitCount}</span>
              <span class="chatroom-unique-visitors">◎ ${visitCounts.uniqueVisitorCount}</span>
            </div>
          </div>
          <div class="chatroom-arrow">›</div>
        </div>
      `;
    })
    .join('');

  chatroomList.querySelectorAll('.chatroom-expand-icon').forEach((icon) => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();
      const chatroomId = icon.getAttribute('data-chatroom-id');
      if (chatroomId) {
        toggleChatroomExpanded(deps, chatroomId);
      }
    });
  });

  chatroomList.querySelectorAll('.chatroom-item').forEach((item) => {
    item.addEventListener('click', () => {
      const chatroomId = item.getAttribute('data-chatroom-id');
      if (chatroomId) {
        showChatroomDetail(deps, chatroomId);
      }
    });
  });
}

export function toggleChatroomExpanded(deps: ChatroomsViewDeps, chatroomId: string): void {
  if (deps.expandedChatrooms.has(chatroomId)) {
    deps.expandedChatrooms.delete(chatroomId);
  } else {
    deps.expandedChatrooms.add(chatroomId);
  }
  deps.renderChatroomList();
}

export function showChatroomDetail(deps: ChatroomsViewDeps, chatroomId: string): void {
  const listContainer = document.getElementById('chatroom-list-container');
  const detailContainer = document.getElementById('chatroom-detail-container');

  if (listContainer) listContainer.style.display = 'none';
  // Keep flex column layout from CSS (#chatroom-detail-container) so #chatroom-members-list can scroll.
  if (detailContainer) detailContainer.style.display = 'flex';
  const backBtn = document.getElementById('back-to-chatrooms') as HTMLElement | null;
  if (backBtn) backBtn.style.display = 'inline-flex';

  const custom = deps.customChatrooms.find((c) => c.id === chatroomId);
  const allChatrooms = getFlatChatroomList();
  const room = allChatrooms.find((entry) => entry.id === chatroomId);
  const roomName = custom
    ? `${customRoomIcon(custom.type)} ${custom.name}`
    : room
      ? `${room.icon} ${room.name}`
      : chatroomId;

  const headerTitle = document.getElementById('header-title');
  const chatroomTitle = document.getElementById('current-chatroom-title');
  const chatroomStatus = document.getElementById('current-chatroom-status');

  if (headerTitle) headerTitle.textContent = roomName;
  if (chatroomTitle) chatroomTitle.textContent = roomName;
  if (chatroomStatus) chatroomStatus.textContent = deps.text('chatroomLoadingMembers');

  deps.setCurrentChatroom(chatroomId);
  syncStatusBroadcastButtonVisibility(chatroomId);

  const ownerBar = document.getElementById('chatroom-owner-bar');
  if (ownerBar) {
    if (custom && deps.currentUserId && custom.createdBy === deps.currentUserId) {
      ownerBar.style.display = 'block';
      ownerBar.innerHTML = `
        <div style="display:flex;gap:8px;flex-wrap:wrap;padding:4px 0 8px;">
          <button type="button" class="btn" id="chatroom-rename-btn" data-testid="chatroom-rename-btn">${deps.text('chatroomRename')}</button>
          <button type="button" class="btn" id="chatroom-delete-btn" data-testid="chatroom-delete-btn" style="background:#b33;color:#fff;">${deps.text('chatroomDelete')}</button>
        </div>`;
      ownerBar.querySelector('#chatroom-rename-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deps.emit('renameCustomChatroom', { chatroomId });
      });
      ownerBar.querySelector('#chatroom-delete-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deps.emit('deleteCustomChatroom', { chatroomId });
      });
    } else {
      ownerBar.style.display = 'none';
      ownerBar.innerHTML = '';
    }
  }

  const membersList = document.getElementById('chatroom-members-list');
  if (membersList) {
    membersList.innerHTML =
      `<div style="padding: 20px; text-align: center; color: #999;">${deps.text('chatroomLoadingOnlineUsers')}</div>`;
    deps.emit('chatroomChanged', chatroomId);
  }
}

export function updateChatroomMembers(
  deps: ChatroomsViewDeps,
  members: ChatroomMember[],
  currentUserId: string,
): void {
  const chatroomMembersList = document.getElementById('chatroom-members-list');
  const chatroomStatus = document.getElementById('current-chatroom-status');
  const otherMembers = members.filter((member) => member.userId !== currentUserId);
  const memberCount = members.length;

  deps.chatroomMemberCounts.set(deps.currentChatroom, memberCount);
  deps.renderChatroomList();
  deps.setCurrentChatroomMembers(otherMembers);

  if (chatroomMembersList) {
    if (chatroomStatus) {
      const visits = deps.chatroomVisitCounts.get(deps.currentChatroom) || { visitCount: 0, uniqueVisitorCount: 0 };
      chatroomStatus.textContent = formatMetrics(deps, memberCount, visits);
    }

    if (otherMembers.length === 0) {
      chatroomMembersList.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
          <p style="font-size: 1.2em; margin-bottom: 8px;">${deps.text('chatroomNoOtherUsers')}</p>
          <p style="font-size: 0.9em; color: #999;">${deps.text('chatroomFirstHere')}</p>
        </div>
      `;
    } else {
      renderMemberList(chatroomMembersList, otherMembers, deps);
      if (deps.apiBase && currentUserId) {
        void loadMemberStats(chatroomMembersList, otherMembers, currentUserId, deps);
      }
    }
  }

  syncStatusBroadcastButtonVisibility(deps.currentChatroom);
}

function renderMemberList(
  container: HTMLElement,
  members: ChatroomMember[],
  deps: ChatroomsViewDeps,
  statsMap?: Map<string, PeerRelationshipStats>,
): void {
  const sorted = statsMap ? sortMembersByRelationship(members, statsMap) : members;

  container.innerHTML = sorted
    .map((member) => {
      const isMatched = deps.matchedUserIds.has(member.userId);
      const stats = statsMap?.get(member.userId);
      const statusText = buildMemberStatusText(isMatched, stats, deps);
      const relationClass = stats
        ? (stats.sent.talks + stats.received.talks === 0 ? 'member-stranger' : 'member-known')
        : '';
      return `
        <div class="chatroom-member-item ${isMatched ? 'member-matched' : ''} ${relationClass}" data-user-id="${deps.escapeHtml(member.userId)}" data-stage-name="${deps.escapeHtml(member.stageName)}"${isMatched ? ' data-matched="true"' : ''}>
          <div class="chatroom-member-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
          <div class="chatroom-member-info">
            <div class="chatroom-member-name">${deps.escapeHtml(member.stageName)}</div>
            <div class="chatroom-member-status">${statusText}</div>
          </div>
          <div class="chatroom-member-arrow">›</div>
        </div>
      `;
    })
    .join('');

  container.querySelectorAll('.chatroom-member-item').forEach((item) => {
    item.addEventListener('click', () => {
      const targetUserId = (item as HTMLElement).dataset.userId;
      const stageName = (item as HTMLElement).dataset.stageName || 'User';
      if (targetUserId) {
        deps.openPeerDetail(targetUserId, stageName);
      }
    });
  });
}

function sortMembersByRelationship(
  members: ChatroomMember[],
  statsMap: Map<string, PeerRelationshipStats>,
): ChatroomMember[] {
  return [...members].sort((a, b) => {
    const sa = statsMap.get(a.userId);
    const sb = statsMap.get(b.userId);
    const totalA = sa ? sa.sent.talks + sa.received.talks : 0;
    const totalB = sb ? sb.sent.talks + sb.received.talks : 0;
    // Strangers (0 talks) first
    if (totalA === 0 && totalB > 0) return -1;
    if (totalB === 0 && totalA > 0) return 1;
    // Among non-strangers: more interaction → later (show newer acquaintances near top)
    return totalB - totalA;
  });
}

function buildMemberStatusText(isMatched: boolean, stats: PeerRelationshipStats | undefined, deps: ChatroomsViewDeps): string {
  if (!stats) return isMatched ? deps.text('chatroomMatched') : deps.text('chatroomOnlineNow');
  const total = stats.sent.talks + stats.received.talks;
  if (total === 0) return deps.text('stranger');
  const parts: string[] = [];
  if (stats.sent.talks > 0) parts.push(`${deps.text('sent')} ${stats.sent.talks}/${stats.sent.matches} ${deps.text('chatroomMatchedCount')}`);
  if (stats.received.talks > 0) parts.push(`${deps.text('received')} ${stats.received.talks}/${stats.received.matches} ${deps.text('chatroomMatchedCount')}`);
  if (stats.mutualTagCount > 0) {
    parts.push(`${stats.mutualTagCount} ${deps.text(stats.mutualTagCount === 1 ? 'chatroomMutualTag' : 'chatroomMutualTags')}`);
  }
  return parts.join(' · ') || deps.text('chatroomOnlineNow');
}

async function loadMemberStats(
  container: HTMLElement,
  members: ChatroomMember[],
  currentUserId: string,
  deps: ChatroomsViewDeps,
): Promise<void> {
  const statsMap = new Map<string, PeerRelationshipStats>();
  await Promise.all(
    members.map(async (member) => {
      try {
        const res = await fetch(
          `${deps.apiBase}/api/users/${encodeURIComponent(currentUserId)}/peers/${encodeURIComponent(member.userId)}/relationship`,
        );
        if (res.ok) {
          const stats: PeerRelationshipStats = await res.json();
          statsMap.set(member.userId, stats);
        }
      } catch {
        // skip — member remains without stats
      }
    }),
  );
  // Re-render with stats (sorted)
  renderMemberList(container, members, deps, statsMap);
}
