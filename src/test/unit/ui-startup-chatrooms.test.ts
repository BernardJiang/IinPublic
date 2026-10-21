/** @jest-environment jsdom */

import { UIManager } from '../../web/ui/ui-manager';
import type { User } from '../../shared/types';

describe('startup chatroom first paint', () => {
  // test:all exports DISABLE_HMR=true for the E2E web build, which makes the list the default;
  // these tests describe the shipped default (map).
  const savedDisableHmr = process.env.DISABLE_HMR;
  beforeEach(() => {
    delete process.env.DISABLE_HMR;
    document.body.innerHTML = '<div id="app"></div>';
    localStorage.clear();
  });
  afterAll(() => {
    if (savedDisableHmr === undefined) delete process.env.DISABLE_HMR;
    else process.env.DISABLE_HMR = savedDisableHmr;
  });

  it('renders a safe local scope before identity or live member counts are available', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();

    expect(document.querySelector('#chatroom-list')?.textContent).toContain('Contacts only');
    expect(document.querySelector('#status-bar-text')?.textContent).toBe('Connecting...');
    // Rooms open on the map by default.
    expect(document.querySelector('#chatroom-list-view-btn')?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('#chatroom-map-view-btn')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('#chatroom-list-view-btn')?.closest('#app-bar-actions')).not.toBeNull();
    expect(
      Array.from(document.querySelectorAll<HTMLElement>('#app-bar-actions .chatroom-view-mode-btn'))
        .map((button) => button.id),
    ).toEqual(['chatroom-map-view-btn', 'chatroom-list-view-btn']);
    expect(document.querySelector('#header-actions')?.lastElementChild?.id).toBe('dm-inbox-btn');
    expect(document.querySelector('#broadcast-talk-btn')?.classList.contains('status-broadcast-btn')).toBe(false);
    expect(document.querySelector('.chatroom-view-toolbar')).toBeNull();
    expect((document.querySelector('#chatroom-map') as HTMLElement | null)?.hidden).toBe(false);
  });

  it('remembers the list view once the user switches to it', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();
    (document.querySelector('#chatroom-list-view-btn') as HTMLButtonElement).click();
    expect(localStorage.getItem('iinpublic_chatroom_browse_mode')).toBe('list');

    document.body.innerHTML = '<div id="app"></div>';
    const reopened = new UIManager();
    reopened.initialize();
    reopened.showStartupInterface();
    expect(document.querySelector('#chatroom-list-view-btn')?.getAttribute('aria-pressed')).toBe('true');
    expect((document.querySelector('#chatroom-map') as HTMLElement | null)?.hidden).toBe(true);
  });

  it('keeps selection-independent header tools working in both map and list views', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();

    (document.getElementById('create-talk-btn') as HTMLButtonElement).click();
    expect(document.getElementById('talk-editor-modal')).not.toBeNull();
    (document.getElementById('cancel-talk-btn') as HTMLButtonElement).click();

    (document.getElementById('chatroom-list-view-btn') as HTMLButtonElement).click();
    expect((document.getElementById('chatroom-list') as HTMLElement).hidden).toBe(false);
    (document.getElementById('create-talk-btn') as HTMLButtonElement).click();
    expect(document.getElementById('talk-editor-modal')).not.toBeNull();
    (document.getElementById('cancel-talk-btn') as HTMLButtonElement).click();

    // Direct messages opens its picker with no room member/contact selected first.
    (document.getElementById('dm-inbox-btn') as HTMLButtonElement).click();
    expect(document.getElementById('dm-inbox-modal')).not.toBeNull();
  });

  it('keeps the first-paint room list when identity hydration completes', () => {
    const ui = new UIManager();
    ui.initialize();
    ui.showStartupInterface();
    const firstPaintScopeRow = document.querySelector('#chatroom-list .chatroom-item');

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

    expect(document.querySelector('#chatroom-list .chatroom-item')).toBe(firstPaintScopeRow);
    expect(document.querySelector('#chatroom-list')?.textContent).toContain('Contacts only');
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
    expect(document.querySelector('#chatroom-list-view-btn .app-bar-btn-label')?.textContent).toBe('列表');
    expect(document.querySelector('#chatroom-map-view-btn .app-bar-btn-label')?.textContent).toBe('地图');
    expect(document.querySelector('#chatroom-list-view-btn')?.getAttribute('aria-label')).toBe('列表');
    expect(document.querySelector('#chatroom-map-view-btn')?.getAttribute('aria-label')).toBe('地图');
  });
});
