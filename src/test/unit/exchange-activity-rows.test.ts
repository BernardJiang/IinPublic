/** @jest-environment jsdom */
import { flashChatroomMemberForNewTalk, flashChatroomMembersSentTo } from '../../web/ui/chatrooms-view';

describe('sending and receiving stay visible without a Broadcast button (OPEN-112)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="chatroom-members-list"><div class="chatroom-member-item" data-user-id="ann"></div></div>
      <div class="nearby-person-item" data-user-id="ann"></div>
      <div class="nearby-person-item" data-user-id="ben"></div>
      <div class="nearby-person-item" data-user-id="cy"></div>`;
  });
  afterEach(() => jest.useRealTimers());

  it('lights up the rows of the people my Talks went to, member and Nearby rows alike, then clears', () => {
    flashChatroomMembersSentTo(['ann', 'ben']);
    expect(document.querySelectorAll('.broadcast-sent-to')).toHaveLength(3);
    expect(document.querySelector('[data-user-id="cy"]')!.classList.contains('broadcast-sent-to')).toBe(false);
    jest.advanceTimersByTime(2500);
    expect(document.querySelectorAll('.broadcast-sent-to')).toHaveLength(0);
  });

  it('flashes the sender of something that arrived, on a Nearby person row too', () => {
    flashChatroomMemberForNewTalk('ben');
    expect(document.querySelector('.nearby-person-item[data-user-id="ben"]')!.classList.contains('flash-new-talk')).toBe(true);
    jest.advanceTimersByTime(1000);
    expect(document.querySelectorAll('.flash-new-talk')).toHaveLength(0);
  });
});
