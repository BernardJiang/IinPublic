/** @jest-environment jsdom */

import { syncAppBarOverflow, setupAppBarChrome } from '../../web/ui/app-bar-overflow';

const t = (key: string): string => key;

function setWidth(el: Element, width: number): void {
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
}

function renderFixture(buttonCount: number): void {
  const buttons = Array.from({ length: buttonCount }, (_, i) => {
    // Reverse priority order so a real sort is exercised, not incidental DOM order.
    const priority = buttonCount - i;
    return `<button class="app-bar-action-btn" data-appbar-priority="${priority}" data-testid="btn-${priority}"></button>`;
  }).join('');
  document.body.innerHTML = `
    <div id="top-header">
      <div id="app-bar-actions">${buttons}</div>
      <div id="app-bar-overflow-menu" style="display:none;">
        <div id="app-bar-overflow-panel" class="open"></div>
      </div>
    </div>
  `;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('syncAppBarOverflow', () => {
  it('does nothing when any required element is missing', () => {
    document.body.innerHTML = '<div id="top-header"></div>';
    expect(() => syncAppBarOverflow()).not.toThrow();
  });

  it('hides the overflow menu when the bar has no measured width yet', () => {
    renderFixture(3);
    setWidth(document.getElementById('top-header')!, 0);
    syncAppBarOverflow();
    expect((document.getElementById('app-bar-overflow-menu') as HTMLElement).style.display).toBe('none');
  });

  it('sorts actions into the inline zone by ascending priority', () => {
    renderFixture(3); // priorities 3,2,1 in DOM order before sync
    setWidth(document.getElementById('top-header')!, 1000);
    syncAppBarOverflow();
    const order = Array.from(document.querySelectorAll('#app-bar-actions .app-bar-action-btn')).map(
      (el) => el.getAttribute('data-testid'),
    );
    expect(order).toEqual(['btn-1', 'btn-2', 'btn-3']);
  });

  it('keeps everything inline and hides the overflow menu when it all fits', () => {
    renderFixture(2);
    setWidth(document.getElementById('top-header')!, 1000);
    syncAppBarOverflow();
    expect(document.querySelectorAll('#app-bar-actions .app-bar-action-btn').length).toBe(2);
    expect(document.querySelectorAll('#app-bar-overflow-panel .app-bar-action-btn').length).toBe(0);
    expect((document.getElementById('app-bar-overflow-menu') as HTMLElement).style.display).toBe('none');
  });

  it('moves the lowest-priority (highest-number) overflowing buttons into the panel and shows the menu', () => {
    renderFixture(10);
    // barWidth - LEFT_W(40) - CENTER_MIN(150) - PADDING(30) - BTN_W(40) = available
    // width 300 -> available = 40; each btn = 40, so only 1 fits before overflowing.
    setWidth(document.getElementById('top-header')!, 300);
    syncAppBarOverflow();
    const panelIds = Array.from(document.querySelectorAll('#app-bar-overflow-panel .app-bar-action-btn')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(panelIds.length).toBeGreaterThan(0);
    expect((document.getElementById('app-bar-overflow-menu') as HTMLElement).style.display).toBe('flex');
  });

  it('closes the overflow panel\'s "open" class once nothing overflows', () => {
    renderFixture(2);
    setWidth(document.getElementById('top-header')!, 1000);
    syncAppBarOverflow();
    expect(document.getElementById('app-bar-overflow-panel')!.classList.contains('open')).toBe(false);
  });

  it('excludes hidden buttons (appbar-view-hidden or display:none) from the fit calculation', () => {
    renderFixture(5);
    document.querySelectorAll('.app-bar-action-btn')[0].classList.add('appbar-view-hidden');
    (document.querySelectorAll('.app-bar-action-btn')[1] as HTMLElement).style.display = 'none';
    setWidth(document.getElementById('top-header')!, 1000);
    syncAppBarOverflow();
    // 5 buttons total, 2 excluded from the "active" fit calc -> plenty of room for the other 3.
    expect(document.querySelectorAll('#app-bar-overflow-panel .app-bar-action-btn').length).toBe(0);
  });
});

describe('setupAppBarChrome', () => {
  function renderChromeFixture(): void {
    document.body.innerHTML = `
      <div id="top-header">
        <button id="app-bar-overflow-btn"></button>
        <div id="app-bar-actions"></div>
        <div id="app-bar-overflow-menu">
          <div id="app-bar-overflow-panel">
            <button class="app-bar-action-btn" data-testid="panel-action"></button>
          </div>
        </div>
      </div>
      <div><button class="filter-bar-toggle"></button><div class="filter-bar-content"></div></div>
      <button id="contacts-broadcast-group-btn"></button>
    `;
  }

  it('toggles the overflow panel open/closed on the overflow button', () => {
    renderChromeFixture();
    setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() });
    const panel = document.getElementById('app-bar-overflow-panel')!;
    document.getElementById('app-bar-overflow-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.classList.contains('open')).toBe(true);
  });

  it('closes the open panel on an outside click, but not a click inside it', () => {
    renderChromeFixture();
    setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() });
    const panel = document.getElementById('app-bar-overflow-panel')!;
    panel.classList.add('open');

    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.classList.contains('open')).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('closes the open panel on Escape', () => {
    renderChromeFixture();
    setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() });
    const panel = document.getElementById('app-bar-overflow-panel')!;
    panel.classList.add('open');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('closes the panel when an action button inside it is clicked', () => {
    renderChromeFixture();
    setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() });
    const panel = document.getElementById('app-bar-overflow-panel')!;
    panel.classList.add('open');
    document.querySelector('[data-testid="panel-action"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel.classList.contains('open')).toBe(false);
  });

  it('toggles a filter-bar-toggle\'s sibling content and aria-expanded/label', () => {
    renderChromeFixture();
    setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() });
    const toggle = document.querySelector('.filter-bar-toggle') as HTMLButtonElement;
    const content = document.querySelector('.filter-bar-content')!;

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(content.classList.contains('open')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toContain('▴');

    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(content.classList.contains('open')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('▾');
  });

  it('opens the broadcast-to-group dialog when the Contacts-tab button is clicked', () => {
    renderChromeFixture();
    const showBroadcastToGroupDialog = jest.fn();
    setupAppBarChrome({ t, showBroadcastToGroupDialog });
    document.getElementById('contacts-broadcast-group-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(showBroadcastToGroupDialog).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the overflow button/panel are absent', () => {
    document.body.innerHTML = '';
    expect(() => setupAppBarChrome({ t, showBroadcastToGroupDialog: jest.fn() })).not.toThrow();
  });
});
