/** @jest-environment jsdom */

import { renderMatchBadge } from '../../web/ui/notification-badges';

beforeEach(() => {
  document.body.innerHTML = `
    <button class="nav-btn" data-view="me"><span class="nav-icon"></span></button>
    <button id="dm-inbox-btn"></button>
  `;
});

function meBadge(): Element | null {
  return document.querySelector('.nav-btn[data-view="me"] .nav-icon .notification-badge');
}
function dmBadge(): Element | null {
  return document.getElementById('dm-inbox-btn')!.querySelector('.notification-badge');
}

describe('renderMatchBadge', () => {
  it('adds no badge when there are no unread conversations', () => {
    renderMatchBadge({});
    expect(meBadge()).toBeNull();
    expect(dmBadge()).toBeNull();
  });

  it('counts only unread, non-support conversations', () => {
    renderMatchBadge({
      a: { unread: true },
      b: { unread: true, supportChannel: true },
      c: { unread: false },
    });
    expect(meBadge()?.textContent).toBe('1');
    expect(dmBadge()?.textContent).toBe('1');
  });

  it('caps the displayed count at "99+"', () => {
    const conversations: Record<string, { unread: boolean }> = {};
    for (let i = 0; i < 150; i++) conversations[`c${i}`] = { unread: true };
    renderMatchBadge(conversations);
    expect(meBadge()?.textContent).toBe('99+');
  });

  it('removes a stale badge when the count drops to zero', () => {
    renderMatchBadge({ a: { unread: true } });
    expect(meBadge()).not.toBeNull();
    renderMatchBadge({ a: { unread: false } });
    expect(meBadge()).toBeNull();
    expect(dmBadge()).toBeNull();
  });

  it('does not duplicate the badge across repeated calls with the same count', () => {
    renderMatchBadge({ a: { unread: true } });
    renderMatchBadge({ a: { unread: true } });
    expect(document.querySelectorAll('.nav-icon .notification-badge').length).toBe(1);
  });

  it('is a no-op when neither target element exists', () => {
    document.body.innerHTML = '';
    expect(() => renderMatchBadge({ a: { unread: true } })).not.toThrow();
  });
});
