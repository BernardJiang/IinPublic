/**
 * Talks-list row gestures, the same on every row (owner design 2026-11-21): swipe left = Pass
 * (on my own row: undo — pass a liked tag, remove a copy, delete a Talk I made); swipe right or
 * down = Like (a tag is liked; a Flow, Survey, Route or Pair-tag opens to answer); long-press
 * selects the row for the AppBar's ✕ ♡ 📌 and shows its details. The row's ✕ and a tap do the
 * same as a swipe left / right (`actOnTalkRow`, talks-list-view.ts).
 *
 * Bound once on `window` (delegated, since rows are re-rendered often). A drag captures the
 * pointer, so it finishes even when the pointer leaves the row or the window; rows carry
 * `touch-action: pan-y`, so a sideways finger swipe belongs to the row (not a page pan the browser
 * cancels) while scrolling up and down still works. A two-finger sideways swipe on a trackpad
 * sends wheel events, not pointer events: it swipes the row under it too.
 */

import { selectTalkRow } from './tag-tap-mode';

export type TalkRowIntent = 'like' | 'pass';

export interface TalksRowGesturesDeps {
  /** A committed or cancelled drag swallows the click that would otherwise follow release. */
  setSuppressClickUntil: (timestamp: number) => void;
  showDetailsPopupFor: (detailsEl: HTMLElement, originalParent: HTMLElement) => void;
  /** Likes or passes the row: the same as a tap or its ✕. */
  actOnRow: (row: HTMLElement, intent: TalkRowIntent) => void;
}

type GestureState = {
  row: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
};

const MOVE_THRESHOLD = 12;
const COMMIT_THRESHOLD = 64;
// Tag chips are short and sit side by side from the left edge: a smaller swipe commits them.
const TAG_COMMIT_THRESHOLD = 48;
const LONG_PRESS_MS = 500;
/** Trackpad: horizontal wheel distance that commits, and the pause that ends one swipe. */
const WHEEL_COMMIT = 80;
const WHEEL_IDLE_MS = 250;
/** Inside a row but not part of its swipe: links, toggles and the row's own ✕. */
const EXCLUDED = '.talk-item-actions, .talk-item-inline-actions, .talk-copy-button, .talk-icon-badge, .talk-matched-people, .talk-sender-people, .talk-item-details, .talk-restore-ignored-btn, .talk-row-pass, .graph-link';

const commitThreshold = (row: HTMLElement): number =>
  (row.classList.contains('talk-tag-chip') ? TAG_COMMIT_THRESHOLD : COMMIT_THRESHOLD);

/** Which way a finished swipe went, or null when it was too short or went up. */
export function swipeIntent(dx: number, dy: number, threshold: number): TalkRowIntent | null {
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  if (absDx > absDy) {
    if (absDx < threshold) return null;
    return dx < 0 ? 'pass' : 'like';
  }
  return dy >= threshold ? 'like' : null;
}

const clearHints = (row: HTMLElement): void => {
  row.classList.remove('talk-gesture-live', 'talk-gesture-hint-ignore', 'talk-gesture-hint-like');
  row.style.transform = '';
  delete row.dataset.gestureLabel;
};

/** The live preview while dragging: the row follows the pointer and shows what release will do. */
function showHint(row: HTMLElement, dx: number, dy: number): void {
  row.classList.add('talk-gesture-live');
  const sideways = Math.abs(dx) >= Math.abs(dy);
  const intent = sideways
    ? (dx < -MOVE_THRESHOLD ? 'pass' : dx > MOVE_THRESHOLD ? 'like' : null)
    : (dy > MOVE_THRESHOLD ? 'like' : null);
  row.style.transform = sideways
    ? `translateX(${Math.max(-100, Math.min(100, dx))}px)`
    : `translateY(${Math.max(0, Math.min(100, dy))}px)`;
  row.classList.toggle('talk-gesture-hint-ignore', intent === 'pass');
  row.classList.toggle('talk-gesture-hint-like', intent === 'like');
  if (intent === 'pass') row.dataset.gestureLabel = row.dataset.passLabel || row.dataset.ignoreLabel || '';
  else if (intent === 'like') row.dataset.gestureLabel = row.dataset.likeLabel || '';
  else delete row.dataset.gestureLabel;
}

/** Swallows exactly the one click a gesture's release fires — not a time window (OPEN-90). */
function swallowNextClick(): void {
  const swallow = (event: MouseEvent): void => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, { once: true, capture: true });
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}

let bound = false;

export function bindTalksRowGestures(deps: TalksRowGesturesDeps): void {
  if (bound) return;
  bound = true;

  let gestureState: GestureState | null = null;

  const rowAt = (target: EventTarget | null): HTMLElement | null => {
    const element = target as HTMLElement | null;
    if (!element?.closest?.('#talks-list')) return null;
    if (element.closest(EXCLUDED)) return null;
    return element.closest('.talk-list-item') as HTMLElement | null;
  };

  window.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const row = rowAt(e.target);
    if (!row) return;
    const state: GestureState = { row, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, dragging: false };
    gestureState = state;
    const longPressTimer = window.setTimeout(() => {
      if (gestureState !== state || state.dragging) return;
      gestureState = null;
      deps.setSuppressClickUntil(Date.now() + 60);
      // The finger or button is still down: swallow exactly the one click its release fires,
      // however long the press lasted, so it neither opens the row nor clears this selection.
      window.addEventListener('pointerup', swallowNextClick, { once: true, capture: true });
      // A long-press selects the row for the AppBar's ✕ Pass · ♡ Like · 📌 Pin (tag-tap-mode.ts).
      selectTalkRow(row);
      const details = row.querySelector('.talk-item-details') as HTMLElement | null;
      if (details) deps.showDetailsPopupFor(details, row);
    }, LONG_PRESS_MS);
    const clearTimer = () => window.clearTimeout(longPressTimer);
    window.addEventListener('pointerup', clearTimer, { once: true });
    window.addEventListener('pointercancel', clearTimer, { once: true });
  }, { passive: true });

  window.addEventListener('pointermove', (e: PointerEvent) => {
    const state = gestureState;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.dragging && Math.max(Math.abs(dx), Math.abs(dy)) < MOVE_THRESHOLD) return;
    if (!state.dragging) {
      state.dragging = true;
      // Keep the drag when the pointer leaves the row or the window. Only once dragging: a
      // capture from the press would retarget taps on links inside the row.
      try { state.row.setPointerCapture?.(state.pointerId); } catch { /* synthetic pointer */ }
    }
    showHint(state.row, dx, dy);
  }, { passive: true });

  window.addEventListener('pointerup', (e: PointerEvent) => {
    const state = gestureState;
    gestureState = null;
    if (!state || !state.dragging) return; // a plain tap, or a long-press its own timer handled
    clearHints(state.row);
    swallowNextClick();
    const intent = swipeIntent(e.clientX - state.startX, e.clientY - state.startY, commitThreshold(state.row));
    if (intent) deps.actOnRow(state.row, intent);
  });

  window.addEventListener('pointercancel', () => {
    const state = gestureState;
    gestureState = null;
    if (state) clearHints(state.row);
  });

  // Trackpad two-finger swipe (wheel deltaX). With natural scrolling, fingers moving left send a
  // positive deltaX, so the row moves the other way to the wheel delta.
  let wheel: { row: HTMLElement; dx: number; done: boolean; idle: number } | null = null;
  const endWheel = (): void => {
    if (wheel && !wheel.done) clearHints(wheel.row);
    wheel = null;
  };
  window.addEventListener('wheel', (e: WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    // A swipe under way stays on its row: the row slides, so what is under the pointer changes
    // (its ✕, the next row). A new one may start anywhere on a row, links included.
    const target = e.target as HTMLElement | null;
    const row = wheel?.row ?? (target?.closest?.('#talks-list') ? target.closest('.talk-list-item') as HTMLElement | null : null);
    if (!row) return;
    e.preventDefault(); // no back/forward navigation, no sideways scroll
    if (!wheel || wheel.row !== row) {
      endWheel();
      wheel = { row, dx: 0, done: false, idle: 0 };
    }
    const current = wheel;
    window.clearTimeout(current.idle);
    current.idle = window.setTimeout(endWheel, WHEEL_IDLE_MS);
    if (current.done) return; // one commit per swipe
    current.dx -= e.deltaX;
    showHint(row, current.dx, 0);
    if (Math.abs(current.dx) >= WHEEL_COMMIT) {
      current.done = true;
      clearHints(row);
      deps.actOnRow(row, current.dx < 0 ? 'pass' : 'like');
    }
  }, { passive: false });
}
