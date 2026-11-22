/** @jest-environment jsdom */

import { swipeIntent, type TalksRowGesturesDeps } from '../../web/ui/talks-row-gestures';

/**
 * `bindTalksRowGestures` binds its listeners once per module instance (mirroring the original
 * `UIManager` field guard). Each test needs a fresh binding, so it re-requires the module inside
 * `jest.isolateModules` to get a clean `bound = false` and a clean in-flight gesture state.
 */
function bindFresh(deps: TalksRowGesturesDeps): void {
  jest.isolateModules(() => {
    // Dynamic re-import is the point: isolateModules only isolates modules loaded via
    // require() inside its callback.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { bindTalksRowGestures } = require('../../web/ui/talks-row-gestures');
    bindTalksRowGestures(deps);
  });
}

function makeDeps(overrides: Partial<TalksRowGesturesDeps> = {}): TalksRowGesturesDeps {
  return {
    setSuppressClickUntil: jest.fn(),
    showDetailsPopupFor: jest.fn(),
    actOnRow: jest.fn(),
    ...overrides,
  };
}

function makeRow(attrs: { talkId?: string; identityKey?: string; role?: string; classes?: string } = {}): HTMLElement {
  document.body.innerHTML = `
    <div id="talks-list">
      <div class="talk-list-item ${attrs.classes ?? ''}" data-talk-id="${attrs.talkId ?? 'talk-1'}" data-identity-key="${attrs.identityKey ?? ''}" data-role="${attrs.role ?? 'incoming'}">
        <div class="talk-item-details">details</div>
      </div>
    </div>
  `;
  return document.querySelector('.talk-list-item') as HTMLElement;
}

// jsdom in this project's test environment doesn't implement the PointerEvent constructor, but
// the code under test only ever reads .button/.clientX/.clientY/.target — all present on the
// MouseEvent it's structurally compatible with, so a plain MouseEvent stands in fine here.
function pointer(type: string, target: EventTarget, x: number, y: number, extra: Partial<MouseEventInit> = {}): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, ...extra }));
}

describe('bindTalksRowGestures: the same gestures on every row (owner 2026-11-21)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  const swipe = (row: HTMLElement, dx: number, dy: number): void => {
    pointer('pointerdown', row, 200, 200);
    pointer('pointermove', document.body, 200 + dx / 2, 200 + dy / 2);
    pointer('pointermove', document.body, 200 + dx, 200 + dy);
    pointer('pointerup', document.body, 200 + dx, 200 + dy);
  };

  it.each([
    ['incoming card', { role: 'incoming' }],
    ['incoming tag', { role: 'incoming', classes: 'talk-tag-chip talk-tag-in' }],
    ['my own card', { role: 'created' }],
    ['my liked tag', { role: 'copied', classes: 'talk-tag-chip talk-tag-out' }],
  ])('%s: left passes, right and down like', (_name, attrs) => {
    for (const [dx, dy, intent] of [[-90, 0, 'pass'], [90, 0, 'like'], [0, 90, 'like']] as const) {
      const row = makeRow(attrs);
      const deps = makeDeps();
      bindFresh(deps);
      swipe(row, dx, dy);
      expect(deps.actOnRow).toHaveBeenCalledTimes(1);
      expect(deps.actOnRow).toHaveBeenCalledWith(row, intent);
    }
  });

  it('swipeIntent: an upward or short move decides nothing', () => {
    expect(swipeIntent(0, -90, 48)).toBeNull();
    expect(swipeIntent(-30, 0, 48)).toBeNull();
    expect(swipeIntent(-60, 10, 48)).toBe('pass');
    expect(swipeIntent(60, 10, 48)).toBe('like');
    expect(swipeIntent(5, 70, 64)).toBe('like');
  });

  it('a drag that leaves the window still finishes (events reach window, not only the row)', () => {
    const row = makeRow({ role: 'incoming', classes: 'talk-tag-chip talk-tag-in' });
    const deps = makeDeps();
    bindFresh(deps);
    pointer('pointerdown', row, 60, 100);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 100 }));
    window.dispatchEvent(new MouseEvent('pointerup', { clientX: -40, clientY: 100 }));
    expect(deps.actOnRow).toHaveBeenCalledWith(row, 'pass');
  });

  it('a two-finger trackpad swipe left passes the row under it, once per swipe', () => {
    jest.useFakeTimers();
    const row = makeRow({ role: 'incoming', classes: 'talk-tag-chip talk-tag-in' });
    const deps = makeDeps();
    bindFresh(deps);
    // Natural scrolling: fingers moving left send a positive deltaX. The row slides under the
    // pointer, so later events land on its ✕: still the same swipe.
    row.insertAdjacentHTML('beforeend', '<button class="talk-row-pass">×</button>');
    const pass = row.querySelector('.talk-row-pass')!;
    for (let i = 0; i < 6; i++) (i === 0 ? row : pass).dispatchEvent(new WheelEvent('wheel', { deltaX: 30, deltaY: 1, bubbles: true, cancelable: true }));
    expect(deps.actOnRow).toHaveBeenCalledTimes(1);
    expect(deps.actOnRow).toHaveBeenCalledWith(row, 'pass');
    jest.advanceTimersByTime(300);
    for (let i = 0; i < 4; i++) row.dispatchEvent(new WheelEvent('wheel', { deltaX: -30, deltaY: 0, bubbles: true, cancelable: true }));
    expect(deps.actOnRow).toHaveBeenLastCalledWith(row, 'like');
    // A vertical scroll is left to the list.
    const scroll = new WheelEvent('wheel', { deltaX: 2, deltaY: 40, bubbles: true, cancelable: true });
    row.dispatchEvent(scroll);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it("a swipe that starts on the row's ✕ or a link is not a swipe", () => {
    const row = makeRow({ role: 'incoming' });
    row.insertAdjacentHTML('beforeend', '<button class="talk-row-pass">×</button><a class="graph-link">2</a>');
    const deps = makeDeps();
    bindFresh(deps);
    for (const selector of ['.talk-row-pass', '.graph-link']) {
      pointer('pointerdown', row.querySelector(selector)!, 200, 200);
      pointer('pointermove', document.body, 100, 200);
      pointer('pointerup', document.body, 100, 200);
    }
    expect(deps.actOnRow).not.toHaveBeenCalled();
  });

  it('a drag swallows exactly the click its release fires; a quick next tap goes through (OPEN-90)', async () => {
    const row = makeRow({ talkId: 'talk-q', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);
    const clicks = jest.fn();
    document.body.addEventListener('click', clicks);

    swipe(row, 0, 80);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).not.toHaveBeenCalled();
    expect(deps.actOnRow).toHaveBeenCalledWith(row, 'like');

    await new Promise((resolve) => setTimeout(resolve, 0));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(deps.setSuppressClickUntil).not.toHaveBeenCalled();
    document.body.removeEventListener('click', clicks);
  });

  it('a movement below the move threshold never starts dragging or commits anything', () => {
    const row = makeRow({ talkId: 'talk-e', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 105, 106);
    pointer('pointerup', document.body, 105, 106);

    expect(deps.actOnRow).not.toHaveBeenCalled();
    expect(row.classList.contains('talk-gesture-live')).toBe(false);
  });

  it.each(['incoming', 'created'])('a long press on a %s card opens the details popup', (role) => {
    jest.useFakeTimers();
    const row = makeRow({ talkId: 'talk-f', role });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    jest.advanceTimersByTime(500);

    expect(deps.showDetailsPopupFor).toHaveBeenCalledWith(row.querySelector('.talk-item-details'), row);
    expect(deps.setSuppressClickUntil).toHaveBeenCalled();
    expect(deps.actOnRow).not.toHaveBeenCalled();
  });

  it('a pointerup before the long-press timer fires cancels the popup', () => {
    jest.useFakeTimers();
    const row = makeRow({ talkId: 'talk-g' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    row.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100, bubbles: true }));
    jest.advanceTimersByTime(500);

    expect(deps.showDetailsPopupFor).not.toHaveBeenCalled();
  });

  it('ignores pointerdown outside #talks-list', () => {
    document.body.innerHTML = '<div class="talk-list-item" data-talk-id="talk-h" data-role="incoming"></div>';
    const row = document.querySelector('.talk-list-item') as HTMLElement;
    const deps = makeDeps();
    bindFresh(deps);
    swipe(row, -90, 0);
    expect(deps.actOnRow).not.toHaveBeenCalled();
  });

  it('a pointercancel clears the in-flight gesture without committing', () => {
    const row = makeRow({ talkId: 'talk-i', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 100, 170);
    document.body.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    pointer('pointerup', document.body, 100, 170);

    expect(deps.actOnRow).not.toHaveBeenCalled();
    expect(row.classList.contains('talk-gesture-live')).toBe(false);
  });
});
