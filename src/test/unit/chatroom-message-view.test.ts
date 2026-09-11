/** @jest-environment jsdom */

import { renderChatroomMessage } from '../../web/ui/chatroom-message-view';

beforeEach(() => {
  document.body.innerHTML = '<div id="messages-container"><div class="text-center p-20">Welcome!</div></div>';
});

describe('renderChatroomMessage', () => {
  it('does nothing when the messages container is absent', () => {
    document.body.innerHTML = '';
    expect(() =>
      renderChatroomMessage({ id: '1', text: 'hi', senderName: 'Alice', timestamp: new Date().toISOString(), isOwnMessage: false }),
    ).not.toThrow();
  });

  it('appends a message bubble and clears the welcome placeholder', () => {
    renderChatroomMessage({
      id: 'm1',
      text: 'hello there',
      senderName: 'Alice',
      timestamp: new Date().toISOString(),
      isOwnMessage: false,
    });
    expect(document.querySelector('.text-center.p-20')).toBeNull();
    const el = document.getElementById('msg-m1');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('hello there');
    expect(el?.textContent).toContain('Alice');
    expect(el?.className).toBe('message ');
  });

  it('does not render the sender name for an own message, and adds the "sent" class', () => {
    renderChatroomMessage({
      id: 'm1',
      text: 'hi',
      senderName: 'Me',
      timestamp: new Date().toISOString(),
      isOwnMessage: true,
    });
    const el = document.getElementById('msg-m1')!;
    expect(el.className).toBe('message sent');
    expect(el.textContent).not.toContain('Me');
  });

  it('does not duplicate a message with the same id', () => {
    const message = { id: 'm1', text: 'hi', senderName: 'Alice', timestamp: new Date().toISOString(), isOwnMessage: false };
    renderChatroomMessage(message);
    renderChatroomMessage(message);
    expect(document.querySelectorAll('#msg-m1').length).toBe(1);
  });

  it('escapes hostile text and sender name', () => {
    renderChatroomMessage({
      id: 'm1',
      text: '<img src=x onerror=alert(1)>',
      senderName: '<script>evil</script>',
      timestamp: new Date().toISOString(),
      isOwnMessage: false,
    });
    const el = document.getElementById('msg-m1')!;
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('<img');
  });
});
