/**
 * A list redraw that keeps the rows that did not change (C10, 2026-11-22: a Talks redraw rebuilt
 * and re-parsed every row, ~63 ms, when one starter chip had changed). Each row's HTML is its key:
 * a row drawn from the same HTML as last time keeps its nodes; only new or changed rows are parsed,
 * all in one parse. The first draw is still progressive (a first chunk at once, the rest after a
 * paint), as `renderListProgressively` does.
 *
 * A row the user just acted on (`data-decided`, or `aria-busy` while its tag flies) is drawn fresh,
 * as before, so a redraw still clears those marks.
 *
 * `flow` lays runs of chip rows side by side in one wrapper (`flowTagChips`), reusing the wrappers.
 */
import type { RenderListProgressivelyOptions } from './render-list-progressively';

export interface FlowRuns {
  /** A top-level row element with this class joins the run of chips around it. */
  itemClass: string;
  /** The wrapper element's class. */
  wrapperClass: string;
  /** A run right after an element with this class gets `groupedClass`. */
  groupedAfterClass?: string;
  groupedClass?: string;
}

export interface RenderRowsKeyedOptions<T> extends RenderListProgressivelyOptions<T> {
  flow?: FlowRuns;
}

type DrawnRow = { html: string; nodes: Element[] };

const drawn = new WeakMap<HTMLElement, DrawnRow[]>();
const ROW_SEPARATOR = 'row-separator';

const isTransient = (node: Element): boolean =>
  node.hasAttribute('data-decided') || node.getAttribute('aria-busy') === 'true';

/** Parses several rows' HTML at once; each row's top-level elements, in order. */
function parseRows(htmls: readonly string[]): Element[][] {
  if (htmls.length === 0) return [];
  const template = document.createElement('template');
  template.innerHTML = htmls.join(`<!--${ROW_SEPARATOR}-->`);
  const rows: Element[][] = [[]];
  for (const node of Array.from(template.content.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE && (node as Comment).data === ROW_SEPARATOR) rows.push([]);
    else if (node.nodeType === Node.ELEMENT_NODE) rows[rows.length - 1]!.push(node as Element);
  }
  return rows;
}

/** Puts exactly `desired` into `parent`, in order, moving only the elements out of place. */
function syncChildren(parent: Element, desired: readonly Element[]): void {
  const wanted = new Set(desired);
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE || !wanted.has(child as Element)) child.remove();
  }
  let cursor = parent.firstElementChild;
  for (const node of desired) {
    if (cursor === node) {
      cursor = cursor.nextElementSibling;
      continue;
    }
    parent.insertBefore(node, cursor);
  }
}

/** True while every node drawn last time is still in `container` (nothing else replaced it). */
function stillDrawn(container: HTMLElement, rows: readonly DrawnRow[] | undefined): rows is DrawnRow[] {
  return !!rows && rows.every((row) => row.nodes.every((node) => container.contains(node)));
}

/** Draws `htmls` into `container`, keeping every row whose HTML is unchanged. Returns the rows drawn. */
export function drawRowsKeyed(container: HTMLElement, htmls: readonly string[], prefixHtml = '', flow?: FlowRuns, keepTransient = false): number {
  const previous = drawn.get(container);
  const reusable = new Map<string, DrawnRow[]>();
  if (stillDrawn(container, previous)) {
    for (const row of previous) {
      if (!keepTransient && row.nodes.some(isTransient)) continue;
      const queue = reusable.get(row.html);
      if (queue) queue.push(row);
      else reusable.set(row.html, [row]);
    }
  } else {
    container.replaceChildren();
  }

  const rows: DrawnRow[] = htmls.map((html) => reusable.get(html)?.shift() ?? { html, nodes: [] });
  const fresh = rows.filter((row) => row.nodes.length === 0);
  // A prefix is drawn as one more row, ahead of the others.
  const prefix: DrawnRow | null = prefixHtml ? (reusable.get(prefixHtml)?.shift() ?? { html: prefixHtml, nodes: [] }) : null;
  if (prefix && prefix.nodes.length === 0) fresh.unshift(prefix);
  parseRows(fresh.map((row) => row.html)).forEach((nodes, index) => { fresh[index]!.nodes = nodes; });

  const ordered = prefix ? [prefix, ...rows] : rows;
  const flat = ordered.flatMap((row) => row.nodes);
  if (!flow) {
    syncChildren(container, flat);
  } else {
    const spareWrappers = Array.from(container.children).filter((child) => child.classList.contains(flow.wrapperClass));
    const top: Element[] = [];
    const runs = new Map<Element, Element[]>();
    let run: Element[] | null = null;
    for (const node of flat) {
      if (!node.classList.contains(flow.itemClass)) {
        run = null;
        top.push(node);
        continue;
      }
      if (!run) {
        const wrapper = spareWrappers.shift() ?? Object.assign(document.createElement('div'), { className: flow.wrapperClass });
        if (flow.groupedClass) {
          const before = top[top.length - 1];
          wrapper.classList.toggle(flow.groupedClass, !!flow.groupedAfterClass && !!before?.classList.contains(flow.groupedAfterClass));
        }
        top.push(wrapper);
        run = [];
        runs.set(wrapper, run);
      }
      run.push(node);
    }
    syncChildren(container, top);
    for (const [wrapper, chips] of runs) syncChildren(wrapper, chips);
  }
  drawn.set(container, ordered);
  return rows.length;
}

/**
 * `renderListProgressively` with kept rows: a redraw over a list drawn here before updates it in
 * one step, keeping unchanged rows; a first draw writes the first chunk, then the rest after a paint.
 */
export function renderRowsKeyed<T>(container: HTMLElement, items: readonly T[], options: RenderRowsKeyedOptions<T>): void {
  const { firstChunkSize, renderRow, prefixHtml = '', onFirstChunkRendered, onRemainderRendered, isStale, scheduleRemainder, flow } = options;
  const firstCount = Math.min(items.length, Math.max(0, firstChunkSize));
  const redraw = stillDrawn(container, drawn.get(container));
  if (redraw || items.length <= firstCount) {
    drawRowsKeyed(container, items.map((item, index) => renderRow(item, index)), prefixHtml, flow);
    onFirstChunkRendered?.(Math.min(items.length, firstCount || items.length), items.length);
    onRemainderRendered?.(items.length);
    return;
  }
  const firstHtml = items.slice(0, firstCount).map((item, index) => renderRow(item, index));
  drawRowsKeyed(container, firstHtml, prefixHtml, flow);
  onFirstChunkRendered?.(firstCount, items.length);
  const schedule = scheduleRemainder ?? ((run: () => void) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.setTimeout(run, 0));
    } else {
      setTimeout(run, 0);
    }
  });
  schedule(() => {
    if (isStale?.()) return;
    const restHtml = items.slice(firstCount).map((item, index) => renderRow(item, firstCount + index));
    // The first chunk was drawn a moment ago: a chip tapped since keeps its marks, as before.
    drawRowsKeyed(container, [...firstHtml, ...restHtml], prefixHtml, flow, true);
    onRemainderRendered?.(items.length);
  });
}
