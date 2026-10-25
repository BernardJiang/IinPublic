/**
 * Renders the aggregate unread-conversation-count badge on both the Me tab's nav icon and the
 * always-visible DM inbox icon (TODO §N2 — same count, two icons: the Me-tab badge only shows
 * while on the Me tab, the DM inbox icon is reachable from every tab). Pure DOM update; the
 * caller supplies the conversation map so this has no `UIManager` instance coupling.
 */
export function renderMatchBadge(
  conversations: Record<string, { unread?: boolean; supportChannel?: boolean; otherUserId?: string }>,
): void {
  const unreadCount = Object.values(conversations).filter((conv) => {
    return conv?.unread && conv.supportChannel !== true;
  }).length;
  // The DM inbox lists people with unread messages (person-picker-dialogs.ts showDmInboxPicker);
  // with nobody to list it is grayed out instead of opening an empty picker (owner, 2026-10-24).
  const hasUnreadSender = Object.values(conversations).some((conv) =>
    conv?.unread && conv.supportChannel !== true && !!conv.otherUserId);

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

  const dmInboxBtn = document.getElementById('dm-inbox-btn') as HTMLButtonElement | null;
  if (dmInboxBtn) {
    dmInboxBtn.disabled = !hasUnreadSender;
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

/** docs/TODO.md OPEN-33: a small badge on the Settings gear icon — same `.notification-badge`
 * element/CSS class the unread-message badges above already use, just a "!" instead of a count,
 * for the Android sideload update reminder (app-update-reminder-view.ts). */
export function renderUpdateAvailableBadge(hasUpdate: boolean): void {
  const settingsTab = document.querySelector('.nav-btn[data-view="settings"] .nav-icon');
  if (!settingsTab) return;
  const existingBadge = settingsTab.querySelector('.notification-badge');
  if (existingBadge) existingBadge.remove();
  if (hasUpdate) {
    const badge = document.createElement('span');
    badge.className = 'notification-badge';
    badge.textContent = '!';
    settingsTab.appendChild(badge);
  }
}
