/** @jest-environment jsdom */

import { showNotification } from '../../web/ui/notification-toast';

const t = (key: string): string => key;

function baseDeps(overrides: Partial<Parameters<typeof showNotification>[3]> = {}) {
  return {
    isSuppressedForE2e: () => false,
    t,
    openConversation: jest.fn(),
    navigateToPerson: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('showNotification', () => {
  it('does nothing when notifications are suppressed for E2E', () => {
    showNotification('hi', 'info', undefined, baseDeps({ isSuppressedForE2e: () => true }));
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('renders the message with the given type class', () => {
    showNotification('Saved!', 'success', undefined, baseDeps());
    const el = document.querySelector('.notification')!;
    expect(el.className).toBe('notification success');
    expect(el.textContent).toBe('Saved!');
  });

  it('marks a content-filter toast with its marker attribute', () => {
    showNotification('blocked', 'error', { contentFilter: 'dirty-word' }, baseDeps());
    expect((document.querySelector('.notification') as HTMLElement).dataset.contentFilterNotification).toBe('dirty-word');
  });

  it('marks a safety toast with its marker attribute', () => {
    showNotification('careful', 'warning', { safetyToast: 'pre-send' }, baseDeps());
    expect((document.querySelector('.notification') as HTMLElement).dataset.safetyToast).toBe('pre-send');
  });

  it('treats a message starting with the match-notice prefix as a persistent match notification', () => {
    showNotification('talksMatchNoticePrefix and more', 'success', undefined, baseDeps());
    expect((document.querySelector('.notification') as HTMLElement).dataset.matchNotification).toBe('true');
  });

  it('respects an explicit options.persistent override in either direction', () => {
    showNotification('ordinary message', 'info', { persistent: true }, baseDeps());
    expect((document.querySelector('.notification') as HTMLElement).dataset.matchNotification).toBe('true');
  });

  it('a Match! toast with a conversationId navigates to that conversation on click', () => {
    const openConversation = jest.fn();
    showNotification('responseMatch', 'success', { conversationId: 'c1' }, baseDeps({ openConversation }));
    document.querySelector('.notification')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openConversation).toHaveBeenCalledWith('c1');
  });

  it('a non-match toast with a peerId navigates to that person on click', () => {
    const navigateToPerson = jest.fn();
    showNotification('New message', 'info', { peerId: 'p1', peerName: 'Alice' }, baseDeps({ navigateToPerson }));
    document.querySelector('.notification')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigateToPerson).toHaveBeenCalledWith({ type: 'person', id: 'p1', name: 'Alice' });
  });

  it('a retryable toast calls retry on click', () => {
    const retry = jest.fn();
    showNotification('Send failed', 'error', { retry }, baseDeps());
    const el = document.querySelector('.notification') as HTMLElement;
    expect(el.dataset.retryable).toBe('true');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('peerId takes precedence over retry when a toast somehow carries both (matches the original if/else-if order)', () => {
    const retry = jest.fn();
    const navigateToPerson = jest.fn();
    showNotification('Send failed', 'error', { retry, peerId: 'p1' }, baseDeps({ navigateToPerson }));
    document.querySelector('.notification')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(navigateToPerson).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });

  it('any click removes the toast from the DOM', () => {
    showNotification('hi', 'info', undefined, baseDeps());
    document.querySelector('.notification')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('auto-dismisses an ordinary toast after 3s', () => {
    showNotification('hi', 'info', undefined, baseDeps());
    expect(document.querySelector('.notification')).not.toBeNull();
    jest.advanceTimersByTime(2999);
    expect(document.querySelector('.notification')).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('auto-dismisses a Match! toast after 8s, not 3s', () => {
    showNotification('responseMatch', 'success', undefined, baseDeps());
    jest.advanceTimersByTime(3000);
    expect(document.querySelector('.notification')).not.toBeNull();
    jest.advanceTimersByTime(5000);
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('auto-dismisses the "no talks to broadcast" toast after 10s', () => {
    showNotification('chatroomNoTalksToBroadcast', 'info', undefined, baseDeps());
    jest.advanceTimersByTime(8000);
    expect(document.querySelector('.notification')).not.toBeNull();
    jest.advanceTimersByTime(2000);
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('auto-dismisses a retryable toast after 8s', () => {
    showNotification('failed', 'error', { retry: jest.fn() }, baseDeps());
    jest.advanceTimersByTime(3000);
    expect(document.querySelector('.notification')).not.toBeNull();
    jest.advanceTimersByTime(5000);
    expect(document.querySelector('.notification')).toBeNull();
  });

  it('does not throw when auto-dismiss fires after the toast was already removed by a click', () => {
    showNotification('hi', 'info', undefined, baseDeps());
    document.querySelector('.notification')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(() => jest.advanceTimersByTime(5000)).not.toThrow();
  });
});
