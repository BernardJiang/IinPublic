/** @jest-environment jsdom */

import { UIManager } from '../../web/ui/ui-manager';

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
});
