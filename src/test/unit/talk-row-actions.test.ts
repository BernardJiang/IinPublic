/** @jest-environment jsdom */
/**
 * `actOnTalkRow` (owner design 2026-11-21): what Like (tap, swipe right or down, ♡) and Pass (✕,
 * swipe left) do on each kind of Talks row. Pass on my own row is undo.
 */
import { actOnTalkRow, type DisplayTalksListDeps } from '../../web/ui/talks-list-view';
import { setMyTalks, getMyTalks } from '../../web/ui/my-talks-storage';

function makeDeps(): DisplayTalksListDeps {
  return {
    quickAnswerIncomingTag: jest.fn(),
    quickIgnoreIncomingTalk: jest.fn(),
    showTalkDetail: jest.fn(),
    deleteMyTalk: jest.fn(),
    restoreIgnoredTalk: jest.fn(),
    showNotification: jest.fn(),
    t: (key: string) => key,
  } as unknown as DisplayTalksListDeps;
}

function row(html: string): HTMLElement {
  document.body.innerHTML = `<div id="talks-list">${html}</div>`;
  return document.querySelector('#talks-list .talk-list-item:last-child') as HTMLElement;
}

describe('actOnTalkRow: Like and Pass on every kind of row', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  it('an incoming tag: Like likes it, Pass passes only that tag', () => {
    const html = '<div class="talk-list-item talk-tag-chip talk-incoming-new" data-starter-tag="true" data-talk-id="a" data-identity-key="ka" data-role="incoming"></div>'
      + '<div class="talk-list-item talk-tag-chip talk-incoming-new" data-starter-tag="true" data-talk-id="b" data-identity-key="kb" data-role="incoming"></div>';
    let deps = makeDeps();
    actOnTalkRow(row(html), 'pass', deps);
    jest.runAllTimers();
    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledTimes(1);
    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('b', 'kb');

    // Liking a starter tag still passes the untapped starter tags above it.
    deps = makeDeps();
    actOnTalkRow(row(html), 'like', deps);
    jest.runAllTimers();
    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('a', 'ka');
    expect(deps.quickAnswerIncomingTag).toHaveBeenCalledWith('b', 'kb', true);
  });

  it('an incoming Flow, Survey or Route: Like opens it to answer, Pass ignores it', () => {
    const html = '<div class="talk-list-item talk-direction-in" data-talk-id="f" data-identity-key="kf" data-role="incoming"></div>';
    const deps = makeDeps();
    actOnTalkRow(row(html), 'like', deps);
    expect(deps.showTalkDetail).toHaveBeenCalledWith('f', 'kf');
    actOnTalkRow(row(html), 'pass', deps);
    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('f', 'kf');
  });

  it('my own rows: Pass is undo, Like does nothing', () => {
    const deps = makeDeps();
    // A liked tag is passed.
    actOnTalkRow(row('<div class="talk-list-item talk-tag-chip" data-talk-id="t" data-role="copied"></div>'), 'pass', deps);
    jest.runAllTimers();
    expect(deps.quickIgnoreIncomingTalk).toHaveBeenCalledWith('t', undefined);
    // A Talk I made is deleted.
    actOnTalkRow(row('<div class="talk-list-item" data-talk-id="mine" data-role="created"></div>'), 'pass', deps);
    expect(deps.deleteMyTalk).toHaveBeenCalledWith('mine');
    // A copied Flow is removed from My Talks.
    setMyTalks({ copy: { role: 'copied', title: 'x' } as any });
    // (Outside #talks-list, so the list refresh after it has nothing to draw.)
    document.body.innerHTML = '<div class="talk-list-item" data-talk-id="copy" data-role="copied"></div>';
    actOnTalkRow(document.querySelector('.talk-list-item') as HTMLElement, 'pass', deps);
    expect(getMyTalks().copy).toBeUndefined();
    // Like on my own row changes nothing.
    const before = makeDeps();
    actOnTalkRow(row('<div class="talk-list-item talk-tag-chip" data-talk-id="t" data-role="copied"></div>'), 'like', before);
    jest.runAllTimers();
    expect(before.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
    expect(before.quickAnswerIncomingTag).not.toHaveBeenCalled();
  });

  it('a passed row: Like takes it back, Pass does nothing', () => {
    const deps = makeDeps();
    actOnTalkRow(row('<div class="talk-list-item talk-tag-chip" data-talk-id="p" data-role="ignored"></div>'), 'like', deps);
    expect(deps.quickAnswerIncomingTag).toHaveBeenCalledWith('p', undefined, true);
    actOnTalkRow(row('<div class="talk-list-item" data-talk-id="q" data-role="ignored"></div>'), 'like', deps);
    expect(deps.restoreIgnoredTalk).toHaveBeenCalledWith('q');
    actOnTalkRow(row('<div class="talk-list-item" data-talk-id="q" data-role="ignored"></div>'), 'pass', deps);
    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
  });

  // Five-phone starter tags (2026-11-21): redraws are gathered, so a tag liked a moment ago still
  // looked unanswered and the next like below it passed it ("Beaches" liked, then passed).
  it('a like below a tag liked a moment ago does not pass it before the list redraws', () => {
    const html = '<div class="talk-list-item talk-tag-chip talk-incoming-new" data-starter-tag="true" data-talk-id="a" data-identity-key="ka" data-role="incoming"></div>'
      + '<div class="talk-list-item talk-tag-chip talk-incoming-new" data-starter-tag="true" data-talk-id="b" data-identity-key="kb" data-role="incoming"></div>';
    document.body.innerHTML = `<div id="talks-list">${html}</div>`;
    const [first, second] = Array.from(document.querySelectorAll<HTMLElement>('#talks-list .talk-list-item'));
    const deps = makeDeps();
    actOnTalkRow(first!, 'like', deps);
    actOnTalkRow(second!, 'like', deps);
    jest.runAllTimers();
    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
    expect(deps.quickAnswerIncomingTag).toHaveBeenCalledWith('a', 'ka', true);
    expect(deps.quickAnswerIncomingTag).toHaveBeenCalledWith('b', 'kb', true);
    // And a pass on the chip just liked does nothing until the redraw shows its real state.
    actOnTalkRow(first!, 'pass', deps);
    jest.runAllTimers();
    expect(deps.quickIgnoreIncomingTalk).not.toHaveBeenCalled();
  });
});
