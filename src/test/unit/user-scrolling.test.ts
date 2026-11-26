/** @jest-environment jsdom */
import { isUserScrolling, resetUserScrollingForTests } from '../../web/ui/user-scrolling';

describe('isUserScrolling (OPEN-113: live redraws wait for a fling to end)', () => {
  beforeEach(() => resetUserScrollingForTests());

  it('is false when nobody touched or scrolled', () => {
    expect(isUserScrolling()).toBe(false);
  });

  it('is true while a finger is down, however long it rests', () => {
    document.dispatchEvent(new Event('touchstart'));
    expect(isUserScrolling(700, Date.now() + 10_000)).toBe(true);
    document.dispatchEvent(new Event('touchend'));
    expect(isUserScrolling(700, Date.now() + 10_000)).toBe(false);
  });

  it('is true for a quiet period after a list scrolled (momentum), then false', () => {
    const list = document.createElement('div');
    document.body.appendChild(list);
    list.dispatchEvent(new Event('scroll')); // does not bubble: caught in the capture phase
    expect(isUserScrolling(700)).toBe(true);
    expect(isUserScrolling(700, Date.now() + 701)).toBe(false);
  });
});
