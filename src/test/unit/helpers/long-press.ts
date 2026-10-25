/**
 * Long-presses an element the way `list-row-selection.ts` listens for it (needs fake timers). The
 * release's click guard is cleared on the next tick, so later clicks in the test go through.
 */
export function longPress(element: Element): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
  jest.advanceTimersByTime(600);
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  jest.advanceTimersByTime(1);
}
