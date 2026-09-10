/**
 * Reflows the legacy ID-based app bar (`#top-header`/`#app-bar-actions`/
 * `#app-bar-overflow-menu`/`#app-bar-overflow-panel`) — sorts actions by priority, then moves
 * whichever don't fit the available width into the overflow panel. Pure DOM layout, no
 * `UIManager` instance state.
 *
 * Note: `app-bar.ts` in this same directory defines a differently-shaped, class-selector-based
 * `updateOverflow`/`renderAppBar`/`AppBarConfig` component system, but is not imported anywhere
 * in the app (confirmed via a repo-wide search) — this function operates on the actual DOM
 * structure `setupAppBarChrome` (`ui-manager.ts`) builds and ships today; the two are unrelated
 * despite the similar name.
 */
export function syncAppBarOverflow(): void {
  const bar = document.getElementById('top-header');
  const inlineZone = document.getElementById('app-bar-actions');
  const menu = document.getElementById('app-bar-overflow-menu');
  const panel = document.getElementById('app-bar-overflow-panel');
  if (!bar || !inlineZone || !menu || !panel) return;
  const all = [
    ...Array.from(inlineZone.querySelectorAll<HTMLElement>('.app-bar-action-btn')),
    ...Array.from(panel.querySelectorAll<HTMLElement>('.app-bar-action-btn')),
  ].sort((a, b) => Number(a.dataset.appbarPriority || 0) - Number(b.dataset.appbarPriority || 0));
  for (const btn of all) inlineZone.appendChild(btn);
  const active = all.filter((btn) => !btn.classList.contains('appbar-view-hidden') && btn.style.display !== 'none');
  const BTN_W = 40;
  const CENTER_MIN = 150;
  const LEFT_W = 40;
  const PADDING = 30;
  const barWidth = bar.clientWidth;
  if (!barWidth) {
    menu.style.display = 'none';
    return;
  }
  const available = barWidth - LEFT_W - CENTER_MIN - PADDING - BTN_W;
  const overflowing: HTMLElement[] = [];
  let used = 0;
  for (const btn of active) {
    used += BTN_W;
    if (used > available) overflowing.push(btn);
  }
  // If everything fits once the ⋯ slot is reclaimed, keep it all inline.
  if (overflowing.length > 0 && active.length * BTN_W <= available + BTN_W) overflowing.length = 0;
  for (const btn of overflowing) panel.appendChild(btn);
  menu.style.display = overflowing.length > 0 ? 'flex' : 'none';
  if (overflowing.length === 0) panel.classList.remove('open');
}

export type AppBarChromeDeps = {
  t: (key: import('./ui-translations').UiTranslationKey) => string;
  showBroadcastToGroupDialog: () => void;
};

/**
 * Binds the app bar's overflow-panel toggle/outside-click/Escape/action-click-closes behavior,
 * the mobile filter-bar disclosure toggles, and the Contacts-tab group-broadcast button — then
 * does the first `syncAppBarOverflow()` pass and wires it to `resize`.
 */
export function setupAppBarChrome(deps: AppBarChromeDeps): void {
  const overflowBtn = document.getElementById('app-bar-overflow-btn');
  const panel = document.getElementById('app-bar-overflow-panel');
  if (overflowBtn && panel) {
    overflowBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      panel.classList.toggle('open');
    });
    document.addEventListener('click', (event) => {
      if (!panel.classList.contains('open')) return;
      const target = event.target;
      if (target instanceof Node && (panel.contains(target) || overflowBtn.contains(target))) return;
      panel.classList.remove('open');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') panel.classList.remove('open');
    });
    // Action buttons keep working from inside the panel (same elements, same
    // listeners); close the panel on any action click. Capture phase, because
    // some button handlers stopPropagation.
    panel.addEventListener(
      'click',
      (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest('.app-bar-action-btn')) {
          panel.classList.remove('open');
        }
      },
      true,
    );
  }
  window.addEventListener('resize', () => syncAppBarOverflow());
  // Mobile filter disclosure: every .filter-bar-toggle opens its sibling content panel.
  document.querySelectorAll<HTMLButtonElement>('.filter-bar-toggle').forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const content = toggle.parentElement?.querySelector<HTMLElement>('.filter-bar-content');
      if (!content) return;
      const open = content.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.textContent = open ? `${deps.t('filters')} ▴` : `${deps.t('filters')} ▾`;
    });
  });
  // docs/TODO.md §U — broadcast to a contact group, from the Contacts tab.
  document.getElementById('contacts-broadcast-group-btn')?.addEventListener('click', () => {
    deps.showBroadcastToGroupDialog();
  });
  syncAppBarOverflow();
}
