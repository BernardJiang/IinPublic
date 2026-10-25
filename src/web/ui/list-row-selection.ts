/**
 * Rows without buttons (owner design 2026-10-25), the pattern the Talks tab started
 * (`tag-tap-mode.ts`): a tap opens a row, a long-press selects it, and the AppBar's actions for
 * that tab act on the selection — grayed out while nothing is selected, or while the selected
 * row is one the action does not apply to. One instance per list (Contacts, Me).
 */

export type RowAction = {
  buttonId: string;
  applies: (row: HTMLElement) => boolean;
  run: (row: HTMLElement) => void;
};

export type RowSelectionConfig = {
  /** The list container, e.g. `#contacts-list`. */
  list: string;
  /** A selectable row inside it. */
  row: string;
  /** A stable key for a row, so the selection survives re-renders. */
  key: (row: HTMLElement) => string;
  actions: RowAction[];
};

export type RowSelection = {
  selected: () => HTMLElement | null;
  select: (row: HTMLElement) => void;
  clear: () => void;
  /** Marks the selected row again (rows are re-rendered often) and syncs the AppBar. */
  reapply: () => void;
};

const LONG_PRESS_MS = 500;
const MOVE_LIMIT_PX = 10;

export function createRowSelection(config: RowSelectionConfig): RowSelection {
  let selectedKey = '';
  const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`${config.list} ${config.row}`));
  const selected = (): HTMLElement | null =>
    (selectedKey ? rows().find((row) => config.key(row) === selectedKey) ?? null : null);

  const reapply = (): void => {
    document.querySelectorAll<HTMLElement>(`${config.list} ${config.row}.is-selected`).forEach((row) => {
      row.classList.remove('is-selected');
      row.removeAttribute('aria-selected');
    });
    const row = selected();
    if (!row && selectedKey) selectedKey = '';
    if (row) {
      row.classList.add('is-selected');
      row.setAttribute('aria-selected', 'true');
    }
    for (const action of config.actions) {
      const button = document.getElementById(action.buttonId) as HTMLButtonElement | null;
      if (button) button.disabled = !row || !action.applies(row);
    }
  };
  const select = (row: HTMLElement): void => {
    selectedKey = config.key(row);
    reapply();
  };
  const clear = (): void => {
    if (!selectedKey) return;
    selectedKey = '';
    reapply();
  };

  document.body.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const row = target.closest(config.row) as HTMLElement | null;
    if (!row || !row.closest(config.list) || target.closest('input, select, textarea')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const stop = (): void => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const move = (moveEvent: PointerEvent): void => {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > MOVE_LIMIT_PX) stop();
    };
    const timer = window.setTimeout(() => {
      stop();
      // The finger or button is still down: swallow exactly the one click its release fires, so
      // the long-press does not also open the row.
      window.addEventListener('pointerup', () => {
        const swallow = (clickEvent: MouseEvent): void => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
        };
        window.addEventListener('click', swallow, { once: true, capture: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }, { once: true, capture: true });
      select(row);
    }, LONG_PRESS_MS);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, { passive: true });

  // Delegated: AppBar buttons can move between the bar and its overflow panel.
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    for (const action of config.actions) {
      if (!target?.closest(`#${action.buttonId}`)) continue;
      const row = selected();
      if (row && action.applies(row)) action.run(row);
      return;
    }
  });

  return { selected, select, clear, reapply };
}
