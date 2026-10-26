/**
 * Talks-list row gestures: swipe any incoming talk left to Ignore/Pass that content; swipe a
 * Tag/Pair-tag right to Like it; or swipe down to retain it in My Talks. Swipe an outgoing/authored row
 * left to delete; or long-press a card to open its details popup. Bound once, globally, on
 * `document.body` (delegated, since rows are
 * re-rendered often). Extracted from `ui-manager.ts` (UIManager decomposition cluster #12,
 * docs/TODO.md Priority 6) — moved as-is, not rewritten, with one deliberate simplification:
 * the original kept its "already bound" flag and in-flight gesture state as `UIManager`
 * instance fields, but neither was ever read outside this one method (confirmed by grep before
 * moving), so they become ordinary module-scoped state here instead of deps — behaviorally
 * identical for a singleton `UIManager`, one fewer thing threaded through the deps object.
 */

import { selectTalkRow } from './tag-tap-mode';

export interface TalksRowGesturesDeps {
  /** A committed or cancelled drag swallows the click that would otherwise follow release —
   *  the only piece of this method's state actually read elsewhere in `UIManager`. */
  setSuppressClickUntil: (timestamp: number) => void;
  showDetailsPopupFor: (detailsEl: HTMLElement, originalParent: HTMLElement) => void;
  quickIgnoreIncomingTalk: (talkId: string, identityKeyFallback: string | undefined) => void;
  quickAnswerIncomingTag: (talkId: string, identityKeyFallback: string | undefined, checked: boolean) => void;
  quickCopyIncomingTalk: (talkId: string, identityKeyFallback: string | undefined) => void;
  deleteMyTalk: (talkId: string) => void;
}

type GestureState = {
  row: HTMLElement;
  talkId: string;
  identityKey: string;
  role: string;
  startX: number;
  startY: number;
  dragging: boolean;
  committedAt: number;
  longPressOnly: boolean;
};

let bound = false;

export function bindTalksRowGestures(deps: TalksRowGesturesDeps): void {
  if (bound) return;
  bound = true;

  const MOVE_THRESHOLD = 12;
  const COMMIT_THRESHOLD = 64;
  // Tag chips are short and sit side by side from the left edge: a smaller swipe commits them.
  const TAG_COMMIT_THRESHOLD = 48;
  const commitThreshold = (row: HTMLElement): number =>
    (row.classList.contains('talk-tag-chip') ? TAG_COMMIT_THRESHOLD : COMMIT_THRESHOLD);
  const LONG_PRESS_MS = 500;
  const excluded = '.talk-item-actions, .talk-item-inline-actions, .talk-copy-button, .talk-icon-badge, .view-talk-btn, .talk-matched-people, .talk-sender-people, .talk-item-details, .talk-restore-ignored-btn';

  let gestureState: GestureState | null = null;

  const clearHints = (row: HTMLElement): void => {
    row.classList.remove('talk-gesture-live');
    row.style.transform = '';
    row.classList.remove('talk-gesture-hint-copy', 'talk-gesture-hint-delete', 'talk-gesture-hint-ignore', 'talk-gesture-hint-like');
    delete row.dataset.gestureLabel;
  };

  document.body.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (!target.closest('#talks-list')) return;
    const row = target.closest('.talk-list-item') as HTMLElement | null;
    if (!row) return;
    const isIncoming = row.dataset.role === 'incoming';
    if (target.closest(excluded) && !(isIncoming && target.closest('.view-talk-btn'))) return;
    // My own tags and passed tags only take a long-press (to select them); they do not drag.
    const longPressOnly = row.classList.contains('talk-tag-chip') && !isIncoming;
    const state: GestureState = {
      row,
      talkId: row.dataset.talkId || '',
      identityKey: row.dataset.identityKey || '',
      role: row.dataset.role || '',
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
      committedAt: 0,
      longPressOnly,
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
      // The finger or button is still down: swallow exactly the one click its release fires, however
      // long the press lasted, so it neither opens the row nor clears the selection made here. Any
      // later click (e.g. on the details popup) goes through.
      window.addEventListener('pointerup', () => {
        const swallow = (event: MouseEvent): void => {
          event.stopPropagation();
          event.preventDefault();
        };
        window.addEventListener('click', swallow, { once: true, capture: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }, { once: true, capture: true });
      // A long-press selects the row for the AppBar's ✕ Pass · ♡ Like · 📌 Pin (tag-tap-mode.ts).
      selectTalkRow(row);
      const details = row.querySelector('.talk-item-details') as HTMLElement | null;
      if (details) deps.showDetailsPopupFor(details, row);
    }, LONG_PRESS_MS);
    const clearTimer = () => window.clearTimeout(longPressTimer);
    row.addEventListener('pointerup', clearTimer, { once: true });
    row.addEventListener('pointercancel', clearTimer, { once: true });
  }, { passive: true });

  document.body.addEventListener('pointermove', (e: PointerEvent) => {
    const state = gestureState;
    if (!state || state.longPressOnly) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.dragging && Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD) return;
    if (!state.dragging) state.row.classList.add('talk-gesture-live');
    state.dragging = true;
    if (state.role === 'incoming') {
      if (Math.abs(dx) >= Math.abs(dy)) {
        state.row.classList.remove('talk-gesture-hint-copy');
        const isTag = state.row.dataset.incomingType === 'tag' || state.row.classList.contains('talk-tag-in');
        const clamped = isTag ? Math.max(-100, Math.min(100, dx)) : Math.max(-100, Math.min(0, dx));
        state.row.style.transform = `translateX(${clamped}px)`;
        state.row.classList.toggle('talk-gesture-hint-ignore', dx < -MOVE_THRESHOLD);
        state.row.classList.toggle('talk-gesture-hint-like', isTag && dx > MOVE_THRESHOLD);
        if (dx < -MOVE_THRESHOLD) state.row.dataset.gestureLabel = state.row.dataset.passLabel || state.row.dataset.ignoreLabel || '';
        else if (isTag && dx > MOVE_THRESHOLD) state.row.dataset.gestureLabel = state.row.dataset.likeLabel || '';
        else delete state.row.dataset.gestureLabel;
      } else if (dy > MOVE_THRESHOLD) {
        state.row.classList.remove('talk-gesture-hint-ignore', 'talk-gesture-hint-like');
        delete state.row.dataset.gestureLabel;
        const clamped = Math.min(100, dy);
        state.row.style.transform = `translateY(${clamped}px)`;
        state.row.classList.toggle('talk-gesture-hint-copy', true);
      }
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
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
    // Swallow exactly the one click this release fires — not a time window, which also ate a
    // quick next tap, e.g. on the Talk a drag-down had just copied (OPEN-90).
    const swallow = (clickEvent: MouseEvent): void => {
      clickEvent.stopPropagation();
      clickEvent.preventDefault();
    };
    window.addEventListener('click', swallow, { once: true, capture: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    const threshold = commitThreshold(state.row);
    if (state.role === 'incoming' && absDx > absDy && absDx >= threshold && dx < 0) {
      deps.quickIgnoreIncomingTalk(state.talkId, state.identityKey || undefined);
    } else if (
      state.role === 'incoming'
      && absDx > absDy
      && absDx >= threshold
      && dx > 0
      && (state.row.dataset.incomingType === 'tag' || state.row.classList.contains('talk-tag-in'))
    ) {
      deps.quickAnswerIncomingTag(state.talkId, state.identityKey || undefined, true);
    } else if (state.role === 'incoming' && absDy >= absDx && dy >= threshold) {
      deps.quickCopyIncomingTalk(state.talkId, state.identityKey || undefined);
    } else if (absDx > absDy && absDx >= threshold && (state.role === 'created' || state.role === 'copied') && dx < 0 && state.talkId) {
      deps.deleteMyTalk(state.talkId);
    }
  });

  document.body.addEventListener('pointercancel', () => {
    const state = gestureState;
    gestureState = null;
    if (state) clearHints(state.row);
  });
}
