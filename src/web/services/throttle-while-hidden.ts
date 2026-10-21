/**
 * OPEN-73: background polls kept running at their foreground rate while the page was hidden
 * (screen off, app in the background), each one a request through the phone's embedded node.
 * Wrap a timer callback so that while the page is hidden it runs at most once per `hiddenMs`;
 * while visible it runs on every tick, exactly as before.
 */
/**
 * Hidden page, or the Android Activity paused: its WebView keeps reporting "visible" with the
 * screen off, so MainActivity sets `__iinpublicNativePaused` in onPause and clears it in onResume.
 */
export function isPageHidden(): boolean {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return true;
  return typeof window !== 'undefined' && (window as unknown as { __iinpublicNativePaused?: boolean }).__iinpublicNativePaused === true;
}

export function throttleWhileHidden(
  fn: () => void,
  hiddenMs: number,
  options: {
    isHidden?: () => boolean;
    now?: () => number;
    /** While visible, run at most this often (0 or absent: every tick). Read on every tick. */
    visibleMs?: () => number;
  } = {},
): () => void {
  const isHidden = options.isHidden ?? isPageHidden;
  const now = options.now ?? Date.now;
  let lastRun = Number.NEGATIVE_INFINITY;
  return () => {
    const minimum = isHidden() ? hiddenMs : (options.visibleMs?.() ?? 0);
    if (now() - lastRun < minimum) return;
    lastRun = now();
    fn();
  };
}
