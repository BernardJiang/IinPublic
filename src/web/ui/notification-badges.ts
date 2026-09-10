/**
 * Renders the aggregate unread-conversation-count badge on both the Me tab's nav icon and the
 * always-visible DM inbox icon (TODO §N2 — same count, two icons: the Me-tab badge only shows
 * while on the Me tab, the DM inbox icon is reachable from every tab). Pure DOM update; the
 * caller supplies the conversation map so this has no `UIManager` instance coupling.
 */
export function renderMatchBadge(conversations: Record<string, { unread?: boolean; supportChannel?: boolean }>): void {
  const unreadCount = Object.values(conversations).filter((conv) => {
    return conv?.unread && conv.supportChannel !== true;
  }).length;

  const meTab = document.querySelector('.nav-btn[data-view="me"] .nav-icon');
  if (meTab) {
    const existingBadge = meTab.querySelector('.notification-badge');
    if (existingBadge) existingBadge.remove();

    if (unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'notification-badge';
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
      meTab.appendChild(badge);
    }
  }

  const dmInboxBtn = document.getElementById('dm-inbox-btn');
  if (dmInboxBtn) {
    const existingBadge = dmInboxBtn.querySelector('.notification-badge');
    if (existingBadge) existingBadge.remove();
    if (unreadCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'notification-badge';
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount.toString();
      dmInboxBtn.appendChild(badge);
    }
  }
}
