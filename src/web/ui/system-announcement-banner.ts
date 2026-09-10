/** A dismissible banner above the chatroom list; dismissal is remembered per-announcement-id via localStorage. */
export function showSystemAnnouncement(announcement: { id: string; text: string }): void {
  const dismissedKey = `iinpublic_dismissed_announcement:${announcement.id}`;
  if (localStorage.getItem(dismissedKey) || document.getElementById(`system-announcement-${announcement.id}`)) return;
  const host = document.getElementById('chatroom-list-container');
  if (!host) return;
  let list = document.getElementById('system-announcements');
  if (!list) {
    list = document.createElement('div');
    list.id = 'system-announcements';
    list.className = 'system-announcements';
    host.prepend(list);
  }
  const banner = document.createElement('div');
  banner.id = `system-announcement-${announcement.id}`;
  banner.className = 'system-announcement';
  const text = document.createElement('span');
  text.textContent = announcement.text;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss announcement');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => {
    localStorage.setItem(dismissedKey, '1');
    banner.remove();
    if (!list?.children.length) list.remove();
  });
  banner.append(text, dismiss);
  list.append(banner);
}
