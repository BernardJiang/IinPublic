type ContactConversation = {
  otherUserId?: string;
  otherUserName?: string;
  talkId?: string;
};

type ContactsViewDeps = {
  getMyConversations: () => Record<string, ContactConversation>;
  getMyTalks: () => Record<string, any>;
  escapeHtml: (text: string) => string;
  showTalkDetail: (talkId: string) => void;
};

export function showContactsList(deps: ContactsViewDeps): void {
  const listContainer = document.getElementById('contacts-list-container');
  const detailContainer = document.getElementById('contact-detail-container');
  if (listContainer) listContainer.style.display = 'block';
  if (detailContainer) detailContainer.style.display = 'none';
  displayContactsList(deps);
}

export function displayContactsList(deps: ContactsViewDeps): void {
  const listEl = document.getElementById('contacts-list');
  if (!listEl) return;

  const conversations = deps.getMyConversations();
  const byUser: Record<
    string,
    { otherUserName: string; conversations: Array<{ conversationId: string; talkId?: string }> }
  > = {};

  for (const [convId, conv] of Object.entries(conversations)) {
    const uid = conv.otherUserId;
    if (!uid) continue;
    if (!byUser[uid]) {
      byUser[uid] = { otherUserName: conv.otherUserName || 'Unknown', conversations: [] };
    }
    const conversationEntry: { conversationId: string; talkId?: string } = {
      conversationId: convId,
    };
    if (conv.talkId) {
      conversationEntry.talkId = conv.talkId;
    }
    byUser[uid].conversations.push(conversationEntry);
  }

  const contactEntries = Object.entries(byUser).sort(
    ([, a], [, b]) => b.conversations.length - a.conversations.length,
  );

  if (contactEntries.length === 0) {
    listEl.innerHTML = `
      <p style="text-align: center; padding: 40px 20px; color: #999;">No contacts yet. Match with others via Talks to see them here.</p>
    `;
    return;
  }

  listEl.innerHTML = contactEntries
    .map(
      ([userId, { otherUserName, conversations }]) => `
        <div class="contact-item" data-contact-user-id="${deps.escapeHtml(userId)}" data-contact-name="${deps.escapeHtml(otherUserName)}" data-contact-count="${conversations.length}" style="display: flex; align-items: center; justify-content: space-between; padding: 16px; margin-bottom: 8px; background: white; border-radius: 12px; border: 1px solid #e0e0e0; cursor: pointer;">
          <div>
            <div class="contact-item-name" style="font-weight: 600;">${deps.escapeHtml(otherUserName)}</div>
            <div class="contact-item-meta" style="font-size: 0.85em; color: #666;">${conversations.length} match(es)</div>
          </div>
          <span style="color: #999;">›</span>
        </div>
      `,
    )
    .join('');

  listEl.querySelectorAll('.contact-item').forEach((el) => {
    el.addEventListener('click', () => {
      const userId = (el as HTMLElement).dataset.contactUserId;
      const name = (el as HTMLElement).dataset.contactName;
      const count = (el as HTMLElement).dataset.contactCount;
      if (userId && name) {
        showContactDetail(deps, userId, name, parseInt(count || '0', 10));
      }
    });
  });
}

export function showContactDetail(
  deps: ContactsViewDeps,
  otherUserId: string,
  otherUserName: string,
  matchCount: number,
): void {
  const listContainer = document.getElementById('contacts-list-container');
  const detailContainer = document.getElementById('contact-detail-container');
  const detailName = document.getElementById('contact-detail-name');
  const detailMatches = document.getElementById('contact-detail-matches');
  const talksList = document.getElementById('contact-talks-list');
  if (!listContainer || !detailContainer || !detailName || !detailMatches || !talksList) return;

  listContainer.style.display = 'none';
  detailContainer.style.display = 'block';
  detailName.textContent = otherUserName;
  detailMatches.textContent = `${matchCount} match(es)`;

  const conversations = deps.getMyConversations();
  const myTalks = deps.getMyTalks();
  const convsWithThisUser = Object.entries(conversations).filter(
    ([, conversation]) => conversation.otherUserId === otherUserId,
  );

  if (convsWithThisUser.length === 0) {
    talksList.innerHTML = '<p style="text-align: center; padding: 20px; color: #999;">No matching talks.</p>';
    return;
  }

  talksList.innerHTML = convsWithThisUser
    .map(([, conversation]) => {
      const talkId = conversation.talkId;
      const talk = talkId ? myTalks[talkId] : null;
      const title = talk?.title || (talkId ? `Talk ${talkId}` : 'Unknown talk');
      return `
        <div class="contact-talk-item" data-talk-id="${talkId || ''}" style="padding: 14px 16px; margin-bottom: 8px; background: #f9f9f9; border-radius: 10px; border: 1px solid #e0e0e0; cursor: pointer;">
          <div style="font-weight: 600;">${deps.escapeHtml(title)}</div>
        </div>
      `;
    })
    .join('');

  talksList.querySelectorAll('.contact-talk-item').forEach((el) => {
    el.addEventListener('click', () => {
      const talkId = (el as HTMLElement).dataset.talkId;
      if (talkId) deps.showTalkDetail(talkId);
    });
  });
}
