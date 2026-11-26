/**
 * Is someone scrolling right now? A live redraw (OPEN-113: an exchange changed the tag counts) that
 * replaces a list's rows mid-fling stops the fling on older WebViews (FRD-L04, Android 7: a fling
 * that ran to 1,870 px stopped at 1,503 px each time). Redraws wait until the finger is up and
 * the list has been still for `quietMs`.
 */
let lastActivityAt = -Infinity;
let touching = false;
let installed = false;

function install(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const mark = (): void => { lastActivityAt = Date.now(); };
  const options = { capture: true, passive: true } as const;
  document.addEventListener('scroll', mark, options);
  document.addEventListener('wheel', mark, options);
  document.addEventListener('touchstart', () => { touching = true; mark(); }, options);
  document.addEventListener('touchmove', mark, options);
  const up = (): void => { touching = false; mark(); };
  document.addEventListener('touchend', up, options);
  document.addEventListener('touchcancel', up, options);
}

install();

export function isUserScrolling(quietMs = 700, now = Date.now()): boolean {
  install();
  return touching || now - lastActivityAt < quietMs;
}

/** Tests only. */
export function resetUserScrollingForTests(): void {
  lastActivityAt = -Infinity;
  touching = false;
}
