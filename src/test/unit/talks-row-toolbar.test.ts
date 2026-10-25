/** @jest-environment jsdom */
/** Talks rows without per-row buttons: chip flow layout, toolbar rules, the "?answer" suffix. */
import { flowTagChips, toolbarActionApplies } from '../../web/ui/tag-tap-mode';
import { tagAnswerSuffix } from '../../web/ui/ui-formatters';

const row = (html: string): HTMLElement => {
  const holder = document.createElement('div');
  holder.innerHTML = html.trim();
  return holder.firstElementChild as HTMLElement;
};

describe('talks row toolbar and layout', () => {
  it('lays consecutive tag chips side by side, indenting a run under a group heading', () => {
    const list = document.createElement('div');
    list.innerHTML = `
      <div class="starter-tag-group-heading">🍜 Food</div>
      <div class="talk-tag-chip" id="a"></div><div class="talk-tag-chip" id="b"></div>
      <div class="talk-list-item" id="card"></div>
      <div class="talk-tag-chip" id="c"></div>`;
    flowTagChips(list);
    const flows = list.querySelectorAll('.talk-tag-chip-flow');
    expect(flows).toHaveLength(2);
    expect(flows[0]!.classList.contains('is-grouped')).toBe(true);
    expect(Array.from(flows[0]!.children).map((chip) => chip.id)).toEqual(['a', 'b']);
    expect(flows[1]!.classList.contains('is-grouped')).toBe(false);
    // A later render chunk continuing the last run joins its wrapper.
    list.insertAdjacentHTML('beforeend', '<div class="talk-tag-chip" id="d"></div>');
    flowTagChips(list);
    expect(Array.from(list.querySelectorAll('.talk-tag-chip-flow')[1]!.children).map((chip) => chip.id)).toEqual(['c', 'd']);
  });

  it('enables each toolbar action only where it applies', () => {
    const incomingTag = row('<div class="talk-list-item talk-tag-chip" data-role="incoming" data-pin-id="p1"></div>');
    const likedTag = row('<div class="talk-list-item talk-tag-chip" data-role="copied" data-pin-id="out:x"></div>');
    const passedTag = row('<div class="talk-list-item talk-tag-chip" data-role="ignored"></div>');
    const incomingCard = row('<div class="talk-list-item" data-role="incoming" data-pin-id="p2"></div>');
    expect(['pass', 'like', 'pin'].map((a) => toolbarActionApplies(a as any, null))).toEqual([false, false, false]);
    expect(['pass', 'like', 'pin'].map((a) => toolbarActionApplies(a as any, incomingTag))).toEqual([true, true, true]);
    expect(['pass', 'like', 'pin'].map((a) => toolbarActionApplies(a as any, likedTag))).toEqual([true, false, true]);
    expect(['pass', 'like', 'pin'].map((a) => toolbarActionApplies(a as any, passedTag))).toEqual([false, true, false]);
    expect(['pass', 'like', 'pin'].map((a) => toolbarActionApplies(a as any, incomingCard))).toEqual([true, false, true]);
  });

  it('shows no "?answer" suffix on a simple tag whose title adds an emoji', () => {
    expect(tagAnswerSuffix({
      title: '☕ Coffee',
      questions: [{ text: 'Coffee', answers: [{ text: 'Coffee', isMatch: true }, { text: 'Ignore', isIgnore: true }] }],
    })).toBe('');
    expect(tagAnswerSuffix({
      title: 'I am hiring',
      questions: [{ text: 'I am hiring', reciprocalTagContext: true, answers: [{ text: 'I am looking for work', isMatch: true }] }],
    })).toContain('?I am looking for work');
  });
});
