/** @jest-environment jsdom */

import { syncReturnHomeButton, type ReturnHomeButtonDeps } from '../../web/ui/return-home-button';

function deps(overrides: Partial<ReturnHomeButtonDeps> = {}): ReturnHomeButtonDeps {
  return {
    getHomeChatroomId: () => 'global',
    currentChatroom: 'global',
    resolveChatroomTitle: (id) => `Title:${id}`,
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<button id="return-home-btn"></button>';
  delete (window as unknown as { __iinpublic_app?: unknown }).__iinpublic_app;
});

describe('syncReturnHomeButton', () => {
  it('does nothing when the button element is absent', () => {
    document.body.innerHTML = '';
    expect(() => syncReturnHomeButton(deps())).not.toThrow();
  });

  it('disables the button and shows "already home" title when in the home room', () => {
    syncReturnHomeButton(deps({ getHomeChatroomId: () => 'global', currentChatroom: 'global' }));
    const btn = document.getElementById('return-home-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Already in your home room');
  });

  it('enables the button and shows a "return to" title when away from the home room', () => {
    syncReturnHomeButton(deps({ getHomeChatroomId: () => 'north-america', currentChatroom: 'global' }));
    const btn = document.getElementById('return-home-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe('Return to Title:north-america');
  });

  it('falls back to the app-level chatroom service when currentChatroom is blank', () => {
    (window as unknown as { __iinpublic_app?: unknown }).__iinpublic_app = {
      getApp: () => ({ chatroomService: { getCurrentChatroomId: () => 'europe' } }),
    };
    syncReturnHomeButton(deps({ getHomeChatroomId: () => 'global', currentChatroom: '' }));
    const btn = document.getElementById('return-home-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe('Return to Title:global');
  });

  it('defaults to "global" when currentChatroom is blank and no app fallback is available', () => {
    syncReturnHomeButton(deps({ getHomeChatroomId: () => 'global', currentChatroom: '' }));
    const btn = document.getElementById('return-home-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
