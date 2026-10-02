/** @jest-environment jsdom */

import type { TalksRowGesturesDeps } from '../../web/ui/talks-row-gestures';

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
    quickIgnoreIncomingTalk: jest.fn(),
    quickCopyIncomingTalk: jest.fn(),
    deleteMyTalk: jest.fn(),
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

describe('bindTalksRowGestures (UIManager decomposition cluster #12)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    jest.useRealTimers();
  });

  it('right-swiping any incoming row ignores its content', () => {
    const row = makeRow({ talkId: 'talk-a', identityKey: 'identity-a', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 180, 100);
    pointer('pointerup', document.body, 180, 100);

    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('talk-a', 'identity-a');
    expect(deps.setSuppressClickUntil).toHaveBeenCalled();
  });

  it('left-swiping any incoming row ignores its content', () => {
    const row = makeRow({ talkId: 'talk-b', identityKey: 'idk-1', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 180, 100);
    pointer('pointermove', document.body, 100, 100);
    pointer('pointerup', document.body, 100, 100);

    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('talk-b', 'idk-1');
    expect(deps.quickCopyIncomingTalk).not.toHaveBeenCalled();
  });

  it('swiping a non-incoming row left past the commit threshold calls deleteMyTalk', () => {
    const row = makeRow({ talkId: 'talk-c', role: 'created' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 200, 100);
    pointer('pointermove', document.body, 120, 100); // dx = -80
    pointer('pointerup', document.body, 120, 100);

    expect(deps.deleteMyTalk).toHaveBeenCalledWith('talk-c');
  });

  it('swiping an incoming row down retains it in My Talks', () => {
    const row = makeRow({ talkId: 'talk-d', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 100, 180);
    pointer('pointerup', document.body, 100, 180);

    expect(deps.quickCopyIncomingTalk).toHaveBeenCalledWith('talk-d', undefined);
    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
  });

  it('right-swiping an incoming tag ignores its content', () => {
    const row = makeRow({ talkId: 'tag-a', role: 'incoming', classes: 'talk-tag-chip talk-tag-in' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 180, 100);
    pointer('pointerup', document.body, 180, 100);

    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('tag-a', undefined);
  });

  it('left-swiping an incoming tag ignores its content', () => {
    const row = makeRow({ talkId: 'tag-b', identityKey: 'tag-identity', role: 'incoming', classes: 'talk-tag-chip talk-tag-in' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 180, 100);
    pointer('pointermove', document.body, 100, 100);
    pointer('pointerup', document.body, 100, 100);

    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('tag-b', 'tag-identity');
  });

  it('does not map an upward incoming gesture to a decision', () => {
    const row = makeRow({ talkId: 'tag-c', role: 'incoming', classes: 'talk-tag-chip talk-tag-in' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 100, 20);
    pointer('pointerup', document.body, 100, 20);

    expect(deps.quickCopyIncomingTalk).not.toHaveBeenCalled();
    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
  });

  it('a movement below the move threshold never starts dragging or commits anything', () => {
    const row = makeRow({ talkId: 'talk-e', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 105, 106); // well under MOVE_THRESHOLD (12)
    pointer('pointerup', document.body, 105, 106);

    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
    expect(deps.quickCopyIncomingTalk).not.toHaveBeenCalled();
    expect(deps.deleteMyTalk).not.toHaveBeenCalled();
    expect(row.classList.contains('talk-gesture-live')).toBe(false);
  });

  it('a long press on an incoming card preserves the details popup action', () => {
    jest.useFakeTimers();
    const row = makeRow({ talkId: 'talk-f', identityKey: 'identity-f', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    jest.advanceTimersByTime(500);

    const details = row.querySelector('.talk-item-details') as HTMLElement;
    expect(deps.quickCopyIncomingTalk).not.toHaveBeenCalled();
    expect(deps.showDetailsPopupFor).toHaveBeenCalledWith(details, row);
    expect(deps.setSuppressClickUntil).toHaveBeenCalled();
  });

  it('a long press on an outgoing card opens the details popup', () => {
    jest.useFakeTimers();
    const row = makeRow({ talkId: 'talk-out', role: 'created' });
    const details = row.querySelector('.talk-item-details') as HTMLElement;
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    jest.advanceTimersByTime(500);

    expect(deps.showDetailsPopupFor).toHaveBeenCalledWith(details, row);
    expect(deps.setSuppressClickUntil).toHaveBeenCalled();
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

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 100, 200);
    pointer('pointerup', document.body, 100, 200);

    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
  });

  it('a pointercancel clears the in-flight gesture without committing', () => {
    const row = makeRow({ talkId: 'talk-i', role: 'incoming' });
    const deps = makeDeps();
    bindFresh(deps);

    pointer('pointerdown', row, 100, 100);
    pointer('pointermove', document.body, 100, 170);
    document.body.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    pointer('pointerup', document.body, 100, 170);

    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
    expect(row.classList.contains('talk-gesture-live')).toBe(false);
  });
});
