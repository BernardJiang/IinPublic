import { focusContactsTopicFilter } from './graph-focus';

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
/**
 * The width an element's text needs, not what it has now: an ellipsized child (the headcount's
 * `.status-bar-meta`) keeps its full width in its own scrollWidth while its flex parent reports
 * the shrunk one (11 px for "0 nearby · 1 online" at 390 px, OPEN-118).
 */
function naturalWidth(el: HTMLElement): number {
  const style = getComputedStyle(el);
  const children = (Array.from(el.children) as HTMLElement[]).filter((child) => getComputedStyle(child).display !== 'none');
  if (!children.length) return el.scrollWidth;
  const widths = children.map(naturalWidth);
  // A flex row lays its children side by side (count, then the Me title); anything else stacks them.
  const row = (style.display === 'flex' || style.display === 'inline-flex') && !style.flexDirection.startsWith('column');
  const inner = row
    ? widths.reduce((sum, width) => sum + width, 0) + (parseFloat(style.columnGap) || 0) * (widths.length - 1)
    : Math.max(...widths);
  return Math.max(el.scrollWidth, inner);
}

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
  const shown = all.filter((btn) => !btn.classList.contains('appbar-view-hidden') && btn.style.display !== 'none');
  // Rarely used actions (ℹ️ the icon legend) always sit under ⋯, never inline (owner, 2026-11-24).
  const menuOnly = shown.filter((btn) => btn.dataset.appbarMenuOnly === '1');
  const active = shown.filter((btn) => btn.dataset.appbarMenuOnly !== '1');
  const BTN_W = 40;
  const CENTER_MIN = 150;
  const LEFT_W = 40;
  const PADDING = 30;
  const barWidth = bar.clientWidth;
  if (!barWidth) {
    for (const btn of menuOnly) panel.appendChild(btn);
    menu.style.display = 'none';
    return;
  }
  // On a phone, an empty back-button slot gives its room to the middle (OPEN-118); on wider bars it
  // stays, so titles do not shift between tabs with and without Back.
  const left = document.getElementById('app-bar-left');
  if (left) {
    const hasBack = Array.from(left.children).some((el) => getComputedStyle(el).display !== 'none');
    left.classList.toggle('is-empty', !hasBack && barWidth < 480);
  }
  const leftWidth = left?.classList.contains('is-empty') ? 0 : LEFT_W;
  // The middle needs room for what it shows (headcount, plus a view title on Me/Settings), so
  // buttons move to ⋯ before the headcount is cut off (owner, 2026-11-24: headcount + 1 button).
  const status = document.getElementById('header-status');
  const centerNeed = status && status.style.display !== 'none'
    ? Array.from(status.children)
      // What is drawn, not the hidden attribute: #status-bar-text's own display rule keeps the
      // headcount visible on every tab.
      .filter((el) => getComputedStyle(el).display !== 'none')
      .reduce((width, el) => width + naturalWidth(el as HTMLElement) + 8, 0)
    : 0;
  // A phone gives the middle up to 70%: its buttons are all still one tap away under ⋯.
  const center = Math.max(CENTER_MIN, Math.min(centerNeed, Math.floor(barWidth * (barWidth < 480 ? 0.7 : 0.6))));
  // Buttons beside the actions that never move to ⋯ (✉️ the DM inbox) take their room first.
  const fixed = Array.from(inlineZone.parentElement?.children ?? [])
    .filter((el) => el !== inlineZone && el !== menu && getComputedStyle(el).display !== 'none')
    .reduce((width, el) => width + (el as HTMLElement).getBoundingClientRect().width, 0);
  const available = barWidth - leftWidth - center - PADDING - BTN_W - fixed;
  const overflowing: HTMLElement[] = [];
  let used = 0;
  for (const btn of active) {
    used += BTN_W;
    if (used > available) overflowing.push(btn);
  }
  // If everything fits once the ⋯ slot is reclaimed, keep it all inline (no ⋯ when nothing needs it).
  if (!menuOnly.length && overflowing.length > 0 && active.length * BTN_W <= available + BTN_W) overflowing.length = 0;
  // The most important action always stays inline (Map on Nearby, ➕ on Talks).
  if (active.length > 0 && overflowing.length === active.length) overflowing.shift();
  const folded = [...overflowing, ...menuOnly];
  for (const btn of folded) panel.appendChild(btn);
  menu.style.display = folded.length > 0 ? 'flex' : 'none';
  if (folded.length === 0) panel.classList.remove('open');
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
  // The headcount and links arrive after the first pass and change on their own: reflow when the
  // middle's text changes, or a long headcount stays cut to "1." beside buttons (OPEN-118).
  // A Back button shown later must also bring its collapsed slot back.
  if (typeof MutationObserver !== 'undefined') {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; syncAppBarOverflow(); });
    });
    for (const id of ['header-status', 'app-bar-left']) {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
    }
  }
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
  // OPEN-87: 🏷️ — find the people who like a tag: Contacts' "Tag or question" filter.
  document.getElementById('contacts-tag-directory-btn')?.addEventListener('click', () => focusContactsTopicFilter());
  syncAppBarOverflow();
}
