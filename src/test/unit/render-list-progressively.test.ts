/**
 * @jest-environment jsdom
 *
 * TODO §R "Recommended approach": one shared helper for the slice-first-N +
 * quiet-background-fill shape used by R1 (Contacts) and, later, R2/R3.
 *
 * Uses the `scheduleRemainder` override (deterministic, manually-triggered) rather than
 * real timers/rAF — a fixed `setTimeout` wait for the real scheduler flaked under load
 * when the full Jest suite ran in parallel with everything else.
 */

import { renderListProgressively } from '../../web/ui/render-list-progressively';

describe('renderListProgressively', () => {
  function container(): HTMLElement {
    document.body.innerHTML = '<div id="list"></div>';
    return document.getElementById('list')!;
  }

  /** Captures the deferred remainder's callback instead of letting a real timer run it. */
  function manualScheduler(): { schedule: (run: () => void) => void; runPending: () => void } {
    let pending: (() => void) | null = null;
    return {
      schedule: (run) => { pending = run; },
      runPending: () => { pending?.(); pending = null; },
    };
  }

  it('renders everything synchronously when the list fits in one chunk', () => {
    const el = container();
    const onFirstChunk = jest.fn();
    const onRemainder = jest.fn();
    renderListProgressively(el, [1, 2, 3], {
      firstChunkSize: 25,
      renderRow: (n) => `<span class="row">${n}</span>`,
      onFirstChunkRendered: onFirstChunk,
      onRemainderRendered: onRemainder,
    });

    expect(Array.from(el.querySelectorAll('.row')).map((r) => r.textContent)).toEqual(['1', '2', '3']);
    expect(onFirstChunk).toHaveBeenCalledWith(3, 3);
    // No remainder to defer — fires immediately, not scheduled.
    expect(onRemainder).toHaveBeenCalledWith(3);
  });

  it('renders the first chunk immediately and defers the remainder, dropping nothing and duplicating nothing', () => {
    const el = container();
    const items = Array.from({ length: 500 }, (_, i) => i);
    const scheduler = manualScheduler();
    let remainderFired = false;
    renderListProgressively(el, items, {
      firstChunkSize: 25,
      renderRow: (n) => `<span class="row">${n}</span>`,
      onRemainderRendered: () => { remainderFired = true; },
      scheduleRemainder: scheduler.schedule,
    });

    // First chunk is on screen before the remainder has any chance to run.
    expect(el.querySelectorAll('.row')).toHaveLength(25);
    expect(remainderFired).toBe(false);

    scheduler.runPending();

    expect(remainderFired).toBe(true);
    const rendered = Array.from(el.querySelectorAll('.row')).map((r) => Number(r.textContent));
    expect(rendered).toHaveLength(500);
    expect(new Set(rendered).size).toBe(500); // no duplicates
    expect(rendered).toEqual(items); // nothing dropped, original order preserved
  });

  it('prepends prefixHtml before the first chunk only, never repeated on the remainder', () => {
    const el = container();
    const scheduler = manualScheduler();
    renderListProgressively(el, Array.from({ length: 30 }, (_, i) => i), {
      firstChunkSize: 10,
      prefixHtml: '<div class="pinned">Pinned</div>',
      renderRow: (n) => `<span class="row">${n}</span>`,
      scheduleRemainder: scheduler.schedule,
    });

    scheduler.runPending();

    expect(el.querySelectorAll('.pinned')).toHaveLength(1);
    expect(el.querySelectorAll('.row')).toHaveLength(30);
  });

  it('drops the remainder silently when isStale reports a newer render has taken over', () => {
    const el = container();
    const scheduler = manualScheduler();
    let stale = false;
    renderListProgressively(el, Array.from({ length: 30 }, (_, i) => i), {
      firstChunkSize: 10,
      renderRow: (n) => `<span class="row">${n}</span>`,
      isStale: () => stale,
      scheduleRemainder: scheduler.schedule,
    });
    stale = true;

    scheduler.runPending();

    // Only the first chunk remains — the remainder was never appended.
    expect(el.querySelectorAll('.row')).toHaveLength(10);
  });

  it('does not touch first-chunk DOM nodes when appending the remainder', () => {
    const el = container();
    const scheduler = manualScheduler();
    renderListProgressively(el, Array.from({ length: 30 }, (_, i) => i), {
      firstChunkSize: 10,
      renderRow: (n) => `<span class="row">${n}</span>`,
      scheduleRemainder: scheduler.schedule,
    });
    const firstRow = el.querySelector('.row');
    (firstRow as HTMLElement).dataset.marker = 'untouched';

    scheduler.runPending();

    expect((el.querySelector('.row') as HTMLElement).dataset.marker).toBe('untouched');
  });

  it('uses a real scheduler (rAF/setTimeout) by default, eventually rendering the remainder', async () => {
    const el = container();
    renderListProgressively(el, Array.from({ length: 30 }, (_, i) => i), {
      firstChunkSize: 10,
      renderRow: (n) => `<span class="row">${n}</span>`,
    });
    expect(el.querySelectorAll('.row')).toHaveLength(10);

    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(el.querySelectorAll('.row')).toHaveLength(30);
  });
});
