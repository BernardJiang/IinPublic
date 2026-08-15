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
});
