/** @jest-environment jsdom */

import { showChooseWhoToDmPicker, showDmInboxPicker } from '../../web/ui/person-picker-dialogs';

const t = (key: string): string => key;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showChooseWhoToDmPicker', () => {
  it('renders one row per person', () => {
    showChooseWhoToDmPicker(
      [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }],
      { t, navigateToPerson: jest.fn() },
    );
    expect(document.querySelectorAll('.talk-dm-picker-row').length).toBe(2);
    expect(document.querySelector('.modal-title')?.textContent).toBe('talksChooseWhoToDm');
  });

  it('navigates to the clicked person and closes the modal', () => {
    const navigateToPerson = jest.fn();
    showChooseWhoToDmPicker([{ id: 'u1', name: 'Alice' }], { t, navigateToPerson });
    document.querySelector('.talk-dm-picker-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(navigateToPerson).toHaveBeenCalledWith({ type: 'person', id: 'u1', name: 'Alice' });
    expect(document.getElementById('talk-dm-picker-modal')).toBeNull();
  });

  it('closes via the close button and via a backdrop click without navigating', () => {
    const navigateToPerson = jest.fn();
    showChooseWhoToDmPicker([{ id: 'u1', name: 'Alice' }], { t, navigateToPerson });
    document.getElementById('close-talk-dm-picker')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('talk-dm-picker-modal')).toBeNull();
    expect(navigateToPerson).not.toHaveBeenCalled();
  });

  it('escapes hostile person names — no script element is ever created, and the visible text is rendered inert', () => {
    showChooseWhoToDmPicker([{ id: 'u1', name: '<script>evil</script>' }], { t, navigateToPerson: jest.fn() });
    expect(document.querySelectorAll('script').length).toBe(0);
    expect(document.querySelector('.talk-dm-picker-row span')?.textContent).toBe('<script>evil</script>');
  });

  it('replaces a stale modal from a previous call', () => {
    showChooseWhoToDmPicker([{ id: 'u1', name: 'Alice' }], { t, navigateToPerson: jest.fn() });
    showChooseWhoToDmPicker([{ id: 'u2', name: 'Bob' }], { t, navigateToPerson: jest.fn() });
    expect(document.querySelectorAll('#talk-dm-picker-modal').length).toBe(1);
    expect(document.querySelectorAll('.talk-dm-picker-row').length).toBe(1);
  });
});

describe('showDmInboxPicker', () => {
  const getPeerName = (userId: string, fallbackName?: string): string => fallbackName || userId;

  it('shows the empty state when there are no unread conversations', () => {
    showDmInboxPicker({ t, navigateToPerson: jest.fn(), getMyConversations: () => ({}), getPeerName });
    expect(document.querySelectorAll('.dm-inbox-row').length).toBe(0);
    expect(document.body.textContent).toContain('dmInboxEmpty');
  });

  it('lists only unread, non-support conversations with an otherUserId, sorted most-recent-first', () => {
    showDmInboxPicker({
      t,
      navigateToPerson: jest.fn(),
      getMyConversations: () => ({
        old: { unread: true, otherUserId: 'u-old', otherUserName: 'Old', lastMessageTime: '2026-01-01T00:00:00Z' },
        recent: { unread: true, otherUserId: 'u-recent', otherUserName: 'Recent', lastMessageTime: '2026-06-01T00:00:00Z' },
        read: { unread: false, otherUserId: 'u-read', otherUserName: 'Read' },
        support: { unread: true, supportChannel: true, otherUserId: 'u-support', otherUserName: 'Support' },
        noOther: { unread: true },
      }),
      getPeerName,
    });
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.dm-inbox-row'));
    expect(rows.map((r) => r.dataset.userId)).toEqual(['u-recent', 'u-old']);
  });

  it('shows the unread count badge, capped at "99+"', () => {
    showDmInboxPicker({
      t,
      navigateToPerson: jest.fn(),
      getMyConversations: () => ({ a: { unread: true, otherUserId: 'u1', unreadCount: 150 } }),
      getPeerName,
    });
    expect(document.querySelector('.dm-inbox-row .notification-badge')?.textContent).toBe('99+');
  });

  it('navigates to the clicked person and closes the modal', () => {
    const navigateToPerson = jest.fn();
    showDmInboxPicker({
      t,
      navigateToPerson,
      getMyConversations: () => ({ a: { unread: true, otherUserId: 'u1', otherUserName: 'Alice' } }),
      getPeerName,
    });
    document.querySelector('.dm-inbox-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigateToPerson).toHaveBeenCalledWith({ type: 'person', id: 'u1', name: 'Alice' });
    expect(document.getElementById('dm-inbox-modal')).toBeNull();
  });
});
