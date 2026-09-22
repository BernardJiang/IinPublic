/**
 * Talks-list row swipe/long-press gestures: swipe an incoming talk row down to ignore or up
 * to copy, swipe an outgoing/authored row left to delete, or long-press any row to open its
 * details popup. Bound once, globally, on `document.body` (delegated, since rows are
 * re-rendered often). Extracted from `ui-manager.ts` (UIManager decomposition cluster #12,
 * docs/TODO.md Priority 6) — moved as-is, not rewritten, with one deliberate simplification:
 * the original kept its "already bound" flag and in-flight gesture state as `UIManager`
 * instance fields, but neither was ever read outside this one method (confirmed by grep before
 * moving), so they become ordinary module-scoped state here instead of deps — behaviorally
 * identical for a singleton `UIManager`, one fewer thing threaded through the deps object.
 */

export interface TalksRowGesturesDeps {
  /** A committed or cancelled drag swallows the click that would otherwise follow release —
   *  the only piece of this method's state actually read elsewhere in `UIManager`. */
  setSuppressClickUntil: (timestamp: number) => void;
  showDetailsPopupFor: (detailsEl: HTMLElement, originalParent: HTMLElement) => void;
  quickIgnoreIncomingTalk: (talkId: string, identityKeyFallback: string | undefined) => void;
  quickCopyIncomingTalk: (talkId: string, identityKeyFallback: string | undefined) => void;
  deleteMyTalk: (talkId: string) => void;
}

type GestureState = {
  row: HTMLElement;
  talkId: string;
  identityKey: string;
  role: string;
  cluster: any;
  startX: number;
  startY: number;
  dragging: boolean;
  committedAt: number;
};

let bound = false;

export function bindTalksRowGestures(deps: TalksRowGesturesDeps): void {
  if (bound) return;
  bound = true;

  const MOVE_THRESHOLD = 12;
  const COMMIT_THRESHOLD = 64;
  const LONG_PRESS_MS = 500;
  const excluded = '.talk-item-actions, .talk-item-inline-actions, .talk-pin-button, .talk-tag-checkbox-wrap, .talk-icon-badge, .view-talk-btn, .talk-matched-people, .talk-sender-people, .talk-item-details';

  let gestureState: GestureState | null = null;

  const clearHints = (row: HTMLElement): void => {
    row.classList.remove('talk-gesture-live');
    row.style.transform = '';
    row.classList.remove('talk-gesture-hint-ignore', 'talk-gesture-hint-copy', 'talk-gesture-hint-delete');
  };

  document.body.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest('#talks-list')) return;
    if (target.closest(excluded)) return;
    const row = target.closest('.talk-list-item') as HTMLElement | null;
    if (!row || row.classList.contains('talk-tag-chip')) return;
    const state: GestureState = {
      row,
      talkId: row.dataset.talkId || '',
      identityKey: row.dataset.identityKey || '',
      role: row.dataset.role || '',
      cluster: undefined,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      committedAt: 0,
    };
    gestureState = state;
    const longPressTimer = window.setTimeout(() => {
      if (gestureState !== state || state.dragging) return;
      gestureState = null;
      // Short window, just long enough to swallow the synthetic click the pointerup
      // that follows the long-press would otherwise fire — NOT long enough to also
      // swallow a real, separate click on something inside the popup that just opened
      // (e.g. a test or a fast double-tap landing on the sender-name a moment later).
      deps.setSuppressClickUntil(Date.now() + 60);
      const details = row.querySelector('.talk-item-details') as HTMLElement | null;
      if (details) deps.showDetailsPopupFor(details, row);
    }, LONG_PRESS_MS);
    const clearTimer = () => window.clearTimeout(longPressTimer);
    row.addEventListener('pointerup', clearTimer, { once: true });
    row.addEventListener('pointercancel', clearTimer, { once: true });
  }, { passive: true });

  document.body.addEventListener('pointermove', (e: PointerEvent) => {
    const state = gestureState;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.dragging && Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD) return;
    if (!state.dragging) state.row.classList.add('talk-gesture-live');
    state.dragging = true;
    if (Math.abs(dy) >= Math.abs(dx)) {
      if (state.role === 'incoming') {
        const clamped = Math.max(-100, Math.min(100, dy));
        state.row.style.transform = `translateY(${clamped}px)`;
        state.row.classList.toggle('talk-gesture-hint-ignore', dy < -MOVE_THRESHOLD);
        state.row.classList.toggle('talk-gesture-hint-copy', dy > MOVE_THRESHOLD);
      }
    } else if (state.role !== 'incoming') {
      const clamped = Math.max(-100, Math.min(0, dx));
      state.row.style.transform = `translateX(${clamped}px)`;
      state.row.classList.toggle('talk-gesture-hint-delete', dx < -MOVE_THRESHOLD);
    }
  }, { passive: true });

  document.body.addEventListener('pointerup', (e: PointerEvent) => {
    const state = gestureState;
    gestureState = null;
    if (!state) return;
    if (!state.dragging) return; // plain tap or a long-press already handled by its own timer
    clearHints(state.row);
    // Same reasoning as the long-press timer: just long enough to swallow the click
    // that naturally follows this same release, not a blanket window that could also
    // eat an unrelated later click.
    deps.setSuppressClickUntil(Date.now() + 60);
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    if (absDy >= absDx && absDy >= COMMIT_THRESHOLD && state.role === 'incoming') {
      if (dy < 0) deps.quickIgnoreIncomingTalk(state.talkId, state.identityKey || undefined);
      else deps.quickCopyIncomingTalk(state.talkId, state.identityKey || undefined);
    } else if (absDx > absDy && absDx >= COMMIT_THRESHOLD && state.role !== 'incoming' && dx < 0 && state.talkId) {
      deps.deleteMyTalk(state.talkId);
    }
  });

  document.body.addEventListener('pointercancel', () => {
    const state = gestureState;
    gestureState = null;
    if (state) clearHints(state.row);
  });
}
