/** @jest-environment jsdom */

import {
  flashChatroomMemberForNewTalk,
  markChatroomMemberMatched,
} from '../../web/ui/chatrooms-view';

describe('chatroom member indicators', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="chatroom-members-list">
        <div class="chatroom-member-item" data-user-id="peer">
          <div class="chatroom-member-status">Known</div>
        </div>
      </div>`;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('records a match and updates the rendered member row', () => {
    const matchedUserIds = new Set<string>();

    markChatroomMemberMatched('peer', matchedUserIds, 'Matched');

    const item = document.querySelector<HTMLElement>('[data-user-id="peer"]')!;
    expect(matchedUserIds.has('peer')).toBe(true);
    expect(item.classList.contains('member-matched')).toBe(true);
    expect(item.dataset.matched).toBe('true');
    expect(item.querySelector('.chatroom-member-status')?.textContent).toBe('Matched');
  });

  it('still records a match when the member row is not currently rendered', () => {
    const matchedUserIds = new Set<string>();

    markChatroomMemberMatched('absent', matchedUserIds, 'Matched');

    expect(matchedUserIds.has('absent')).toBe(true);
  });

  it('restarts and clears the new-talk flash after one second', () => {
    jest.useFakeTimers();
    const item = document.querySelector<HTMLElement>('[data-user-id="peer"]')!;
    item.classList.add('flash-new-talk');

    flashChatroomMemberForNewTalk('peer');
    expect(item.classList.contains('flash-new-talk')).toBe(true);

    jest.advanceTimersByTime(1000);
    expect(item.classList.contains('flash-new-talk')).toBe(false);
  });
});
