/** @jest-environment jsdom */

import { getPinnedIds, pinnedFirst, toggleListItemPin } from '../../web/ui/list-pins';

describe('list pins', () => {
  beforeEach(() => localStorage.clear());

  it('persists pins independently per list and toggles them off', () => {
    expect(toggleListItemPin('contacts', 'alice')).toBe(true);
    expect(toggleListItemPin('talks', 'out:talk-1')).toBe(true);
    expect(getPinnedIds('contacts')).toEqual(new Set(['alice']));
    expect(getPinnedIds('talks')).toEqual(new Set(['out:talk-1']));

    expect(toggleListItemPin('contacts', 'alice')).toBe(false);
    expect(getPinnedIds('contacts').size).toBe(0);
  });

  it('moves pinned items first without disturbing either tier\'s current order', () => {
    toggleListItemPin('answers', 'second');
    toggleListItemPin('answers', 'fourth');
    const rows = ['first', 'second', 'third', 'fourth'];

    expect(pinnedFirst(rows, 'answers', (row) => row)).toEqual([
      'second',
      'fourth',
      'first',
      'third',
    ]);
  });

  it('recovers from malformed storage instead of breaking list rendering', () => {
    localStorage.setItem('iinpublic_list_pins_v1', '{not json');
    expect(pinnedFirst(['one', 'two'], 'talks', (row) => row)).toEqual(['one', 'two']);
  });
});

