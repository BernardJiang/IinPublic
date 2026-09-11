/** @jest-environment jsdom */

import { showSystemAnnouncement } from '../../web/ui/system-announcement-banner';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<div id="chatroom-list-container"></div>';
});

describe('showSystemAnnouncement', () => {
  it('does nothing when the host container is absent', () => {
    document.body.innerHTML = '';
    expect(() => showSystemAnnouncement({ id: 'a1', text: 'Hello' })).not.toThrow();
  });

  it('renders the banner text, prepended before other content', () => {
    document.getElementById('chatroom-list-container')!.innerHTML = '<div id="existing">rooms</div>';
    showSystemAnnouncement({ id: 'a1', text: 'Scheduled maintenance tonight' });
    const list = document.getElementById('system-announcements')!;
    expect(list).not.toBeNull();
    expect(list.nextElementSibling?.id).toBe('existing');
    expect(document.getElementById('system-announcement-a1')?.textContent).toContain('Scheduled maintenance tonight');
  });

  it('does not render the same announcement twice', () => {
    showSystemAnnouncement({ id: 'a1', text: 'Hello' });
    showSystemAnnouncement({ id: 'a1', text: 'Hello again' });
    expect(document.querySelectorAll('#system-announcement-a1').length).toBe(1);
    expect(document.getElementById('system-announcement-a1')?.textContent).toContain('Hello');
    expect(document.getElementById('system-announcement-a1')?.textContent).not.toContain('Hello again');
  });

  it('never re-renders an announcement id the user already dismissed, even after reload', () => {
    localStorage.setItem('iinpublic_dismissed_announcement:a1', '1');
    showSystemAnnouncement({ id: 'a1', text: 'Hello' });
    expect(document.getElementById('system-announcement-a1')).toBeNull();
  });

  it('dismissing removes the banner and remembers the dismissal', () => {
    showSystemAnnouncement({ id: 'a1', text: 'Hello' });
    document.querySelector('.system-announcement button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('system-announcement-a1')).toBeNull();
    expect(localStorage.getItem('iinpublic_dismissed_announcement:a1')).toBe('1');
  });

  it('removes the shared list container once the last banner is dismissed', () => {
    showSystemAnnouncement({ id: 'a1', text: 'One' });
    document.querySelector('.system-announcement button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('system-announcements')).toBeNull();
  });

  it('keeps the shared list container when another banner remains after dismissal', () => {
    showSystemAnnouncement({ id: 'a1', text: 'One' });
    showSystemAnnouncement({ id: 'a2', text: 'Two' });
    document.querySelector('#system-announcement-a1 button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('system-announcements')).not.toBeNull();
    expect(document.getElementById('system-announcement-a2')).not.toBeNull();
  });

  it('reuses the same shared list container for multiple distinct announcements', () => {
    showSystemAnnouncement({ id: 'a1', text: 'One' });
    showSystemAnnouncement({ id: 'a2', text: 'Two' });
    expect(document.querySelectorAll('#system-announcements').length).toBe(1);
    expect(document.querySelectorAll('.system-announcement').length).toBe(2);
  });
});
