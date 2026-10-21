/** Map explanations should teach briefly without permanently covering the map. */
export const MAP_HINT_VISIBLE_MS = 6_000;

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function hideTransientMapHint(element: HTMLElement): void {
  const timer = timers.get(element);
  if (timer) clearTimeout(timer);
  timers.delete(element);
  element.hidden = true;
}

export function showTransientMapHint(
  element: HTMLElement,
  durationMs = MAP_HINT_VISIBLE_MS,
): void {
  const prior = timers.get(element);
  if (prior) clearTimeout(prior);
  element.hidden = false;
  const timer = setTimeout(() => {
    timers.delete(element);
    element.hidden = true;
  }, Math.max(0, durationMs));
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  timers.set(element, timer);
}
