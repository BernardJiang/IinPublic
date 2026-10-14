/** @jest-environment jsdom */

import {
  hideTransientMapHint,
  MAP_HINT_VISIBLE_MS,
  showTransientMapHint,
} from '../../web/ui/transient-map-hint';

describe('transient map hints', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows an explanation briefly and then removes it from the visible map', () => {
    const hint = document.createElement('div');
    hint.hidden = true;
    showTransientMapHint(hint);
    expect(hint.hidden).toBe(false);

    jest.advanceTimersByTime(MAP_HINT_VISIBLE_MS - 1);
    expect(hint.hidden).toBe(false);
    jest.advanceTimersByTime(1);
    expect(hint.hidden).toBe(true);
  });

  it('can be dismissed immediately and safely shown again for a new map visit', () => {
    const hint = document.createElement('div');
    showTransientMapHint(hint);
    hideTransientMapHint(hint);
    expect(hint.hidden).toBe(true);

    showTransientMapHint(hint);
    expect(hint.hidden).toBe(false);
    jest.advanceTimersByTime(MAP_HINT_VISIBLE_MS);
    expect(hint.hidden).toBe(true);
  });
});
