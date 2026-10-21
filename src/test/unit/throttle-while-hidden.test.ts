/** OPEN-73: background polls slow down only while the page is hidden. */
import { isPageHidden, throttleWhileHidden } from '../../web/services/throttle-while-hidden';

describe('throttleWhileHidden', () => {
  it('runs every tick while visible and at most once per window while hidden', () => {
    let hidden = false;
    let now = 0;
    const fn = jest.fn();
    const tick = throttleWhileHidden(fn, 60_000, { isHidden: () => hidden, now: () => now });
    tick(); now += 3_000; tick(); now += 3_000; tick();
    expect(fn).toHaveBeenCalledTimes(3);
    hidden = true;
    now += 3_000; tick(); // last run 3 s ago → skipped
    expect(fn).toHaveBeenCalledTimes(3);
    now += 60_000; tick();
    expect(fn).toHaveBeenCalledTimes(4);
    now += 3_000; tick();
    expect(fn).toHaveBeenCalledTimes(4);
    hidden = false;
    now += 3_000; tick();
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it('slows a visible poll to its own quiet interval when one is given', () => {
    let now = 0;
    let quiet = false;
    const fn = jest.fn();
    const tick = throttleWhileHidden(fn, 120_000, {
      isHidden: () => false,
      now: () => now,
      visibleMs: () => (quiet ? 30_000 : 0),
    });
    tick(); now += 5_000; tick();
    expect(fn).toHaveBeenCalledTimes(2);
    quiet = true;
    for (let i = 0; i < 5; i += 1) { now += 5_000; tick(); }
    expect(fn).toHaveBeenCalledTimes(2);
    now += 5_000; tick();
    expect(fn).toHaveBeenCalledTimes(3);
    quiet = false;
    now += 5_000; tick();
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('treats a paused Android Activity as hidden', () => {
    const page = globalThis as unknown as { window?: { __iinpublicNativePaused?: boolean } | undefined };
    const hadWindow = 'window' in page;
    const previous = page.window;
    page.window = { __iinpublicNativePaused: true };
    try {
      expect(isPageHidden()).toBe(true);
      page.window.__iinpublicNativePaused = false;
      expect(isPageHidden()).toBe(false);
    } finally {
      if (hadWindow) page.window = previous;
      else delete page.window;
    }
  });
});
