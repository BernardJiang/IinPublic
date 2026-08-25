/** @jest-environment jsdom */

import { UIManager } from '../../web/ui/ui-manager';
import type { User } from '../../shared/types';

describe('startup chatroom first paint', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
  });

  it('renders Global before identity or live member counts are available', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();

    expect(document.querySelector('#chatroom-list')?.textContent).toContain('Global');
    expect(document.querySelector('#status-bar-text')?.textContent).toBe('Connecting...');
  });

  it('keeps the first-paint room list when identity hydration completes', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();
    const firstPaintGlobalRow = document.querySelector('#chatroom-list .chatroom-item');

    ui.showMainInterface({
      id: 'startup-user',
      stageName: 'Startup User',
      profile: [],
      reputation: {} as User['reputation'],
      location: { region: '', chatrooms: [] },
      languages: ['en'],
      interests: [],
      createdAt: new Date(),
      lastActive: new Date(),
      knownPeople: [],
    } as User);

    expect(document.querySelector('#chatroom-list .chatroom-item')).toBe(firstPaintGlobalRow);
    expect(document.querySelector('#chatroom-list')?.textContent).toContain('Global');
  });

  it('renders the stable application shell before feature views hydrate', () => {
    const ui = new UIManager();
    ui.initialize();

    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.view-container > .view-panel')).map(
        (panel) => panel.id,
      ),
    ).toEqual(['chatrooms-view', 'contacts-view', 'talks-view', 'me-view', 'settings-view']);
    expect(document.querySelector('#chatrooms-view')?.classList.contains('active')).toBe(true);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.bottom-nav > .nav-btn')).map(
        (button) => button.dataset.view,
      ),
    ).toEqual(['chatrooms', 'contacts', 'talks', 'me', 'settings']);
    expect(document.querySelector('.bottom-nav > .nav-btn.active')?.getAttribute('data-view')).toBe(
      'chatrooms',
    );

    expect(
      Array.from(document.querySelectorAll<HTMLOptionElement>('#reply-filter-language option')).map(
        (option) => [option.value, option.textContent],
      ),
    ).toEqual([
      ['all', 'All languages'],
      ['en', 'English'],
      ['zh', 'Chinese'],
      ['es', 'Spanish'],
      ['fr', 'French'],
      ['de', 'German'],
      ['ja', 'Japanese'],
      ['ko', 'Korean'],
    ]);
  });

  it('uses the selected UI language for shell accessibility text', () => {
    localStorage.setItem('iinpublic_ui_language', 'zh');

    const ui = new UIManager();
    ui.initialize();

    const broadcastButton = document.querySelector('#contacts-broadcast-group-btn');
    expect(broadcastButton?.getAttribute('title')).toBe('广播给分组…');
    expect(broadcastButton?.getAttribute('aria-label')).toBe('广播给分组…');
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('.bottom-nav .nav-label')).map(
        (label) => label.textContent,
      ),
    ).toEqual(['聊天室', '联系人', '话题', '我的', '设置']);
    expect(document.querySelector('#reply-filter-language option[value="en"]')?.textContent).toBe(
      '英语',
    );

    const contactsToggle = document.querySelector<HTMLElement>('[data-testid="contacts-filter-toggle"]');
    contactsToggle?.setAttribute('aria-expanded', 'true');
    (ui as unknown as { applyShellTranslations(): void }).applyShellTranslations();
    expect(contactsToggle?.textContent).toBe('筛选 ▴');
  });
});
