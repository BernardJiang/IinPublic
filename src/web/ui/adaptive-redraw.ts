/**
 * A redraw that a burst of calls shares (the Talks list: every arrival, answer and outcome asks).
 * Within a second of the user's own tap, click or key a call always draws at once. Otherwise, after
 * a quiet spell a call draws at once; within the gap after a
 * redraw, one trailing redraw is scheduled. The gap is at least `minGapMs` and three times the last
 * redraw's cost, so redrawing never takes more than about a third of a slow phone's page (C10,
 * 2026-11-21: a full redraw per event left the page 5 % idle and made each starter tap take ~14 s).
 */
/** A redraw this soon after the user's own tap, click or key is the answer to it: drawn at once. */
const AFTER_INPUT_MS = 1_000;
let lastInputAt = -Infinity;
if (typeof document !== 'undefined') {
  for (const type of ['pointerdown', 'click', 'keydown'] as const) {
    document.addEventListener(type, () => { lastInputAt = Date.now(); }, { capture: true, passive: true });
  }
}

export function adaptiveRedraw(
  draw: () => void,
  minGapMs = 250,
  now: () => number = Date.now,
  /** True while the screen still shows something the user decided as undecided: draw at once. */
  urgent: () => boolean = () => false,
): () => void {
  let drawnAt = -Infinity;
  let costMs = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = (): void => {
    const at = now();
    const gap = Math.max(minGapMs, costMs * 3);
    // Only the redraws nobody is waiting for are gathered: a tap's own redraw is never held back
    // (phone-path 10, hung hub: a Talks row first reacted after 1.8 s).
    const userWaiting = Date.now() - lastInputAt < AFTER_INPUT_MS || urgent();
    if (!userWaiting && at - drawnAt < gap) {
      timer ??= setTimeout(() => {
        timer = undefined;
        request();
      }, gap - (at - drawnAt));
      return;
    }
    if (timer) { clearTimeout(timer); timer = undefined; }
    drawnAt = at;
    draw();
    costMs = now() - at;
  };
  return request;
}
