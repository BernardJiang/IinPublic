import { getFlatChatroomList } from '../../shared/chatroom-hierarchy';

type ChatroomMember = { userId: string; stageName: string };

type ChatroomsViewDeps = {
  currentChatroom: string;
  chatroomMemberCounts: Map<string, number>;
  expandedChatrooms: Set<string>;
  matchedUserIds: Set<string>;
  setCurrentChatroom: (chatroomId: string) => void;
  setCurrentChatroomMembers: (members: ChatroomMember[]) => void;
  escapeHtml: (text: string) => string;
  renderChatroomList: () => void;
  showTalksFromUserOrConversation: (userId: string, stageName: string) => void;
  emit: (eventName: string, payload: unknown) => void;
};

export function syncStatusBroadcastButtonVisibility(currentChatroom: string): void {
  const wrap = document.getElementById('status-bar-actions');
  if (!wrap) return;
  wrap.style.display = currentChatroom ? 'block' : 'none';
}

export function renderChatroomList(deps: ChatroomsViewDeps): void {
  const allChatrooms = getFlatChatroomList();

  if (deps.currentChatroom && !allChatrooms.find((room) => room.id === deps.currentChatroom)) {
    allChatrooms.unshift({
      id: deps.currentChatroom,
      name: 'My Location',
      icon: '📍',
      level: 0,
      description: 'Your current location chatroom',
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

  const chatroomList = document.getElementById('chatroom-list');
  if (!chatroomList) return;

  chatroomList.innerHTML = visibleChatrooms
    .map((room) => {
      const memberCount = deps.chatroomMemberCounts.get(room.id) || 0;
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
              ${isCurrentRoom ? '<span class="current-room-badge">Current</span>' : ''}
              <span class="chatroom-headcount">${memberCount > 0 ? `👥 ${memberCount}` : '👥 0'}</span>
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
  if (detailContainer) detailContainer.style.display = 'block';

  const allChatrooms = getFlatChatroomList();
  const room = allChatrooms.find((entry) => entry.id === chatroomId);
  const roomName = room ? `${room.icon} ${room.name}` : chatroomId;

  const headerTitle = document.getElementById('header-title');
  const chatroomTitle = document.getElementById('current-chatroom-title');
  const chatroomStatus = document.getElementById('current-chatroom-status');

  if (headerTitle) headerTitle.textContent = roomName;
  if (chatroomTitle) chatroomTitle.textContent = roomName;
  if (chatroomStatus) chatroomStatus.textContent = 'Loading members...';

  deps.setCurrentChatroom(chatroomId);
  syncStatusBroadcastButtonVisibility(chatroomId);

  const membersList = document.getElementById('chatroom-members-list');
  if (membersList) {
    membersList.innerHTML =
      '<div style="padding: 20px; text-align: center; color: #999;">Loading online users...</div>';
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

  deps.chatroomMemberCounts.set(deps.currentChatroom, members.length);
  deps.renderChatroomList();
  deps.setCurrentChatroomMembers(otherMembers);

  if (chatroomMembersList) {
    if (chatroomStatus) {
      chatroomStatus.textContent = `👥 ${members.length} member${members.length !== 1 ? 's' : ''} total`;
    }

    if (otherMembers.length === 0) {
      chatroomMembersList.innerHTML = `
        <div class="empty-state" style="padding: 40px 20px; text-align: center;">
          <p style="font-size: 1.2em; margin-bottom: 8px;">No other users here yet</p>
          <p style="font-size: 0.9em; color: #999;">You're the first one in this chatroom!</p>
        </div>
      `;
    } else {
      chatroomMembersList.innerHTML = otherMembers
        .map((member) => {
          const isMatched = deps.matchedUserIds.has(member.userId);
          return `
            <div class="chatroom-member-item" data-user-id="${member.userId}" data-stage-name="${deps.escapeHtml(member.stageName)}" ${isMatched ? ' data-matched="true"' : ''}>
              <div class="chatroom-member-avatar">${member.stageName.charAt(0).toUpperCase()}</div>
              <div class="chatroom-member-info">
                <div class="chatroom-member-name">${member.stageName}</div>
                <div class="chatroom-member-status">${isMatched ? 'Matched' : 'Online now'}</div>
              </div>
            </div>
          `;
        })
        .join('');

      chatroomMembersList.querySelectorAll('.chatroom-member-item').forEach((el) => {
        if ((el as HTMLElement).dataset.matched === 'true') {
          el.classList.add('member-matched');
        }
      });

      chatroomMembersList.querySelectorAll('.chatroom-member-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const targetUserId = (e.currentTarget as HTMLElement).getAttribute('data-user-id');
          const stageName = (e.currentTarget as HTMLElement).getAttribute('data-stage-name') || 'User';
          if (targetUserId) {
            deps.showTalksFromUserOrConversation(targetUserId, stageName);
          }
        });
      });
    }
  }

  syncStatusBroadcastButtonVisibility(deps.currentChatroom);
}
