/** @jest-environment jsdom */
/**
 * C10 (2026-11-22): a Talks redraw re-parsed every row. Rows whose HTML did not change now keep
 * their nodes; chips still sit in one wrapper per run; a just-decided chip is drawn fresh.
 */
import { drawRowsKeyed, renderRowsKeyed, type FlowRuns } from '../../web/ui/render-rows-keyed';
import { flowTagChips } from '../../web/ui/tag-tap-mode';

const FLOW: FlowRuns = { itemClass: 'talk-tag-chip', wrapperClass: 'talk-tag-chip-flow', groupedAfterClass: 'starter-tag-group-heading', groupedClass: 'is-grouped' };
const chip = (id: string, state = '') => `<div class="talk-list-item talk-tag-chip" data-talk-id="${id}">${id}${state}</div>`;
const card = (id: string) => `<div class="talk-list-item" data-talk-id="${id}">${id}</div>`;
const heading = '<div class="starter-tag-group-heading">Group</div>';
const byId = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-talk-id="${id}"]`)!;
const shape = (el: HTMLElement) => Array.from(el.children).map((child) =>
  child.classList.contains('talk-tag-chip-flow')
    ? `[${child.classList.contains('is-grouped') ? 'g:' : ''}${Array.from(child.children).map((c) => (c as HTMLElement).dataset.talkId).join(',')}]`
    : (child as HTMLElement).dataset.talkId || child.className);

describe('drawRowsKeyed', () => {
  it('keeps unchanged rows and parses only the changed one', () => {
    const el = document.createElement('div');
    drawRowsKeyed(el, [card('a'), card('b'), card('c')]);
    const [a, b, c] = ['a', 'b', 'c'].map((id) => byId(el, id));
    drawRowsKeyed(el, [card('a'), '<div class="talk-list-item" data-talk-id="b">B!</div>', card('c')]);
    expect(byId(el, 'a')).toBe(a);
    expect(byId(el, 'c')).toBe(c);
    expect(byId(el, 'b')).not.toBe(b);
    expect(byId(el, 'b').textContent).toBe('B!');
    expect(shape(el)).toEqual(['a', 'b', 'c']);
  });

  it('follows removals, insertions and reorders', () => {
    const el = document.createElement('div');
    drawRowsKeyed(el, [card('a'), card('b'), card('c')]);
    const c = byId(el, 'c');
    drawRowsKeyed(el, [card('c'), card('d'), card('a')]);
    expect(shape(el)).toEqual(['c', 'd', 'a']);
    expect(byId(el, 'c')).toBe(c);
    expect(el.querySelector('[data-talk-id="b"]')).toBeNull();
  });

  it('lays runs of chips out like flowTagChips, and keeps the wrappers and chips', () => {
    const rows = [card('x'), heading, chip('1'), chip('2'), card('y'), chip('3')];
    const el = document.createElement('div');
    drawRowsKeyed(el, rows, '', FLOW);
    const reference = document.createElement('div');
    reference.innerHTML = rows.join('');
    flowTagChips(reference);
    expect(shape(el)).toEqual(shape(reference));
    expect(shape(el)).toEqual(['x', 'starter-tag-group-heading', '[g:1,2]', 'y', '[3]']);

    const wrapper = el.querySelector('.talk-tag-chip-flow');
    const two = byId(el, '2');
    // Chip 1 is liked: it leaves the run; the heading moves on with the group.
    drawRowsKeyed(el, [card('x'), heading, chip('2'), card('y'), chip('3'), chip('1', ' ♡')], '', FLOW);
    expect(shape(el)).toEqual(['x', 'starter-tag-group-heading', '[g:2]', 'y', '[3,1]']);
    expect(el.querySelector('.talk-tag-chip-flow')).toBe(wrapper);
    expect(byId(el, '2')).toBe(two);
    flowTagChips(el);
    expect(shape(el)).toEqual(['x', 'starter-tag-group-heading', '[g:2]', 'y', '[3,1]']);
  });

  it('draws a just-decided or flying chip fresh, so a redraw clears its marks as before', () => {
    const el = document.createElement('div');
    drawRowsKeyed(el, [chip('1'), chip('2')], '', FLOW);
    byId(el, '1').dataset.decided = 'true';
    byId(el, '2').setAttribute('aria-busy', 'true');
    const [one, two] = [byId(el, '1'), byId(el, '2')];
    drawRowsKeyed(el, [chip('1'), chip('2')], '', FLOW);
    expect(byId(el, '1')).not.toBe(one);
    expect(byId(el, '2')).not.toBe(two);
    expect(el.querySelector('[data-decided], [aria-busy]')).toBeNull();
  });

  it('starts over when something else replaced the list', () => {
    const el = document.createElement('div');
    drawRowsKeyed(el, [card('a')]);
    el.innerHTML = '<div class="empty-state">none</div>';
    drawRowsKeyed(el, [card('a'), card('b')]);
    expect(shape(el)).toEqual(['a', 'b']);
  });
});

describe('renderRowsKeyed', () => {
  it('draws a first chunk, then the rest after a paint; a later redraw is one step', () => {
    const el = document.createElement('div');
    let later: (() => void) | null = null;
    const render = (n: number) => card(String(n));
    renderRowsKeyed(el, [1, 2, 3, 4], { firstChunkSize: 2, renderRow: render, scheduleRemainder: (run) => { later = run; } });
    expect(shape(el)).toEqual(['1', '2']);
    const one = byId(el, '1');
    later!();
    expect(shape(el)).toEqual(['1', '2', '3', '4']);
    expect(byId(el, '1')).toBe(one);

    let scheduled = false;
    renderRowsKeyed(el, [1, 2, 5, 3, 4], { firstChunkSize: 2, renderRow: render, scheduleRemainder: () => { scheduled = true; } });
    expect(scheduled).toBe(false);
    expect(shape(el)).toEqual(['1', '2', '5', '3', '4']);
    expect(byId(el, '1')).toBe(one);
  });

  it('a chip tapped between the first chunk and the rest keeps its mark', () => {
    const el = document.createElement('div');
    let later: (() => void) | null = null;
    renderRowsKeyed(el, ['1', '2', '3'], { firstChunkSize: 1, renderRow: (id) => chip(id), flow: FLOW, scheduleRemainder: (run) => { later = run; } });
    byId(el, '1').dataset.decided = 'true';
    later!();
    expect(byId(el, '1').dataset.decided).toBe('true');
    expect(shape(el)).toEqual(['[1,2,3]']);
  });
});
