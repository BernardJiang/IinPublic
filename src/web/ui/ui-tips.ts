import { appDataLoaded, appStorage } from '../services/core-storage';

/**
 * A tip shown once on this device (then only on request): explanations that used to be fixed
 * lines inside a view (owner, 2026-11-16). Not under automation, where a toast would cover taps.
 */
export function showTipOnce(key: string, message: string, notify: (message: string) => void): void {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return;
  if (!appDataLoaded()) return;
  let seen: Record<string, boolean> = {};
  try { seen = JSON.parse(appStorage.getItem('tipsSeen') || '{}') || {}; } catch { seen = {}; }
  if (seen[key]) return;
  seen[key] = true;
  appStorage.setItem('tipsSeen', JSON.stringify(seen));
  notify(message);
}

/** A tap on an element already shown (a view's title) shows its tip again. */
export function bindTipOnTap(elementId: string, message: () => string, notify: (message: string) => void): void {
  const element = document.getElementById(elementId);
  if (!element || element.dataset.tipBound) return;
  element.dataset.tipBound = '1';
  const show = () => notify(message());
  element.addEventListener('click', show);
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); }
  });
}
