/**
 * TODO §R "Recommended approach": one shared helper for the slice-first-N +
 * quiet-background-fill shape, instead of each long list (Contacts, Talks, Answers)
 * reinventing it slightly differently. Modeled on the two halves already proven
 * separately elsewhere in this codebase: the Replies panel's manual
 * PAGE_SIZE/visibleCount/load-more slice (ui-manager.ts), and chatroom members'
 * render-then-enrich-non-blocking pattern (chatrooms-view.ts). This helper does the
 * *automatic* quiet-fill variant the R1-R3 requirement wording asks for ("retrieved
 * quietly in the background"), not a manual button.
 */

export interface RenderListProgressivelyOptions<T> {
  /** How many items to render synchronously, immediately. */
  firstChunkSize: number;
  /** Renders one item's HTML. Called for every item, first chunk and remainder alike. */
  renderRow: (item: T, index: number) => string;
  /** HTML written before the first chunk (e.g. a pinned row that isn't part of `items`). */
  prefixHtml?: string;
  /** Fires once the first chunk's HTML has been written to `container.innerHTML`. */
  onFirstChunkRendered?: (renderedCount: number, totalCount: number) => void;
  /**
   * Fires once the remainder has been appended (or immediately, with the full count,
   * when there was no remainder to defer).
   */
  onRemainderRendered?: (totalCount: number) => void;
  /**
   * Checked immediately before writing the deferred remainder. If it returns true, the
   * remainder is silently dropped instead of appended — a newer render has since taken
   * over the container (mirrors contacts-view.ts's `contactsRenderSeq` staleness guard).
   */
  isStale?: () => boolean;
  /** Overridable for tests; defaults to a rAF-then-setTimeout(0) chain. */
  scheduleRemainder?: (run: () => void) => void;
}

function defaultScheduleRemainder(run: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => window.setTimeout(run, 0));
    return;
  }
  setTimeout(run, 0);
}

/**
 * Renders `items` into `container` in two phases: the first `firstChunkSize` items
 * synchronously (so something is on screen immediately, independent of list size or
 * any caller-side blocking chain), then the remainder appended off the main render
 * path once the browser has had a chance to paint. Never re-renders the first chunk —
 * the remainder is appended via `insertAdjacentHTML`, so first-chunk DOM nodes (and
 * any listeners already bound to them) are untouched.
 */
export function renderListProgressively<T>(
  container: HTMLElement,
  items: readonly T[],
  options: RenderListProgressivelyOptions<T>,
): void {
  const { firstChunkSize, renderRow, prefixHtml = '', onFirstChunkRendered, onRemainderRendered, isStale, scheduleRemainder } = options;
  const firstChunk = items.slice(0, Math.max(0, firstChunkSize));
  container.innerHTML = prefixHtml + firstChunk.map((item, index) => renderRow(item, index)).join('');
  onFirstChunkRendered?.(firstChunk.length, items.length);

  if (items.length <= firstChunk.length) {
    onRemainderRendered?.(items.length);
    return;
  }

  const remainder = items.slice(firstChunk.length);
  const schedule = scheduleRemainder ?? defaultScheduleRemainder;
  schedule(() => {
    if (isStale?.()) return;
    const html = remainder.map((item, index) => renderRow(item, firstChunk.length + index)).join('');
    container.insertAdjacentHTML('beforeend', html);
    onRemainderRendered?.(items.length);
  });
}
