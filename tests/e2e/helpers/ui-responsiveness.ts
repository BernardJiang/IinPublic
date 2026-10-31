/**
 * GUI responsiveness harness (docs/testing/gui-responsiveness-test-plan.md).
 *
 * Three tools, used together by the `*-gui-responsiveness-*` specs:
 *
 *  - `stallHub` / `failHub` — simulate a hung network (requests to the hub never answer, the
 *    hub WebSocket opens but stays silent) or a dead one (every request fails at once). A hung
 *    network is the case users hit on phones; it is also the one that exposes an `await fetch()`
 *    with no timeout in a click path, which a fast failure hides.
 *  - `installMainThreadProbe` — a 50 ms heartbeat plus a long-task observer, so a spec can
 *    tell "the button did nothing" from "the page's main thread was frozen".
 *  - `clickAndExpectResponse` / `sweepClickables` — click a control and require a visible
 *    reaction (any DOM change outside the ignored background regions, a focus change, a
 *    browser dialog, a popup, a download or a file chooser) within a deadline.
 */
import { expect, type Locator, type Page, type Route } from '@playwright/test';
import { gunPort } from './ports';

/** Visible reaction deadline for a tap. Above ~1 s a user taps again or thinks the app froze. */
export const UI_RESPONSE_DEADLINE_MS = 1_000;
/**
 * After a miss, keep watching this long: a reaction that comes late is reported as `late`
 * (slow feedback) rather than `never` (dead control), and cannot leak into the next click.
 */
export const UI_LATE_WINDOW_MS = 4_000;
/** A main-thread gap longer than this is a visible freeze (input and paint both stop). */
export const UI_FREEZE_GAP_MS = 1_000;

/** Regions that change on their own (clocks, counters, toasts from background work). */
const DEFAULT_IGNORED_MUTATION_ROOTS = [
  '#status-bar',
  '#status-bar-text',
  '.network-status',
  '.app-bar-network',
  '[data-testid="connection-status"]',
];

export type HubFault = 'stall' | 'fail';

export interface HubFaultHandle {
  /** Requests intercepted since the fault was applied (proves the fault is actually hit). */
  intercepted(): number;
  /** Remove the fault. Held (stalled) requests are aborted so nothing resumes half-way. */
  clear(): Promise<void>;
}

function hubUrlPattern(): RegExp {
  const port = gunPort();
  return new RegExp(`^(https?|wss?)://(127\\.0\\.0\\.1|localhost):${port}/`);
}

/**
 * Make the hub unreachable for this page's browser context, from now on.
 *
 * `stall`: every HTTP request to the hub is held forever and the WebSocket is replaced by a
 * silent mock — the "connected to Wi-Fi with no internet" / captive-portal / dead-cell case.
 * `fail`: every HTTP request fails immediately and the WebSocket is closed — airplane mode.
 *
 * Context-level routes also cover the device-core worker's requests (OPEN-91 P6).
 */
export async function applyHubFault(page: Page, fault: HubFault): Promise<HubFaultHandle> {
  const context = page.context();
  const pattern = hubUrlPattern();
  const held: Route[] = [];
  let intercepted = 0;
  const handler = async (route: Route): Promise<void> => {
    intercepted += 1;
    if (fault === 'fail') {
      await route.abort('internetdisconnected').catch(() => undefined);
      return;
    }
    held.push(route); // never answered while the fault is on
  };
  await context.route(pattern, handler);
  await context.routeWebSocket(pattern, (ws) => {
    intercepted += 1;
    // Not calling ws.connectToServer(): the page sees an open socket that never answers.
    if (fault === 'fail') void ws.close({ code: 1006, reason: 'hub unreachable (e2e)' }).catch(() => undefined);
  });
  return {
    intercepted: () => intercepted,
    clear: async () => {
      await context.unroute(pattern, handler).catch(() => undefined);
      for (const route of held.splice(0)) await route.abort('connectionreset').catch(() => undefined);
    },
  };
}

export const stallHub = (page: Page): Promise<HubFaultHandle> => applyHubFault(page, 'stall');
export const failHub = (page: Page): Promise<HubFaultHandle> => applyHubFault(page, 'fail');

/**
 * Hold only requests whose URL matches `match` (e.g. `/api/debug/storage`), letting the rest
 * through — used to pin one specific un-timed-out call found by the audit.
 */
export async function stallHubPath(page: Page, match: RegExp): Promise<HubFaultHandle> {
  const context = page.context();
  const held: Route[] = [];
  let intercepted = 0;
  const handler = async (route: Route): Promise<void> => {
    if (!match.test(route.request().url())) {
      await route.fallback();
      return;
    }
    intercepted += 1;
    held.push(route);
  };
  await context.route(hubUrlPattern(), handler);
  return {
    intercepted: () => intercepted,
    clear: async () => {
      await context.unroute(hubUrlPattern(), handler).catch(() => undefined);
      for (const route of held.splice(0)) await route.abort('connectionreset').catch(() => undefined);
    },
  };
}

/* ── Main-thread probe ─────────────────────────────────────────────────────────────── */

/**
 * Install before `goto`. Records the longest gap between 50 ms heartbeat ticks and every long
 * task (>50 ms) since the last `readMainThreadProbe(page, { reset: true })`.
 */
export async function installMainThreadProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __uiProbe?: { maxGap: number; last: number; longTasks: number[]; reset: () => void };
    };
    if (w.__uiProbe) return;
    const probe = {
      maxGap: 0,
      last: performance.now(),
      longTasks: [] as number[],
      reset() {
        probe.maxGap = 0;
        probe.longTasks = [];
        probe.last = performance.now();
      },
    };
    w.__uiProbe = probe;
    setInterval(() => {
      const now = performance.now();
      probe.maxGap = Math.max(probe.maxGap, now - probe.last);
      probe.last = now;
    }, 50);
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.longTasks.push(Math.round(entry.duration));
      }).observe({ type: 'longtask', buffered: false });
    } catch {
      /* longtask unsupported (Firefox/WebKit): the heartbeat gap still measures freezes */
    }
  });
}

export interface MainThreadSample {
  maxGapMs: number;
  longTasksMs: number[];
}

export async function readMainThreadProbe(page: Page, options: { reset?: boolean } = {}): Promise<MainThreadSample> {
  return page.evaluate((reset) => {
    const probe = (window as unknown as {
      __uiProbe?: { maxGap: number; last: number; longTasks: number[]; reset: () => void };
    }).__uiProbe;
    if (!probe) return { maxGapMs: 0, longTasksMs: [] };
    // Include the gap still open right now (a freeze that has not ended yet).
    const openGap = performance.now() - probe.last;
    const sample = { maxGapMs: Math.round(Math.max(probe.maxGap, openGap)), longTasksMs: [...probe.longTasks] };
    if (reset) probe.reset();
    return sample;
  }, options.reset === true);
}

/* ── Click → visible reaction ──────────────────────────────────────────────────────── */

export interface ClickResponse {
  /** False when the control could not be clicked at all (covered, detached, page frozen). */
  clicked: boolean;
  responded: boolean;
  /**
   * What counted as the reaction: 'dom' (any DOM change, or a checkbox/radio tick), 'field-focus'
   * (a select or text field took focus — its picker or caret is the reaction), 'dialog', 'popup',
   * 'download' or 'filechooser'. A button that only takes focus has NOT reacted.
   */
  via: string | null;
  latencyMs: number | null;
  /** Set when there was no reaction by the deadline but one came within UI_LATE_WINDOW_MS. */
  lateMs: number | null;
  /** The first change seen, e.g. `childList on div.modal-overlay` — for reading a sweep report. */
  evidence: string | null;
  /** False when the page never went quiet before the click (background churn; result is weak). */
  quietBefore: boolean;
  mainThread: MainThreadSample;
}

type ClickWatch = {
  observer: MutationObserver;
  firstAt: number | null;
  evidence: string | null;
  t0: number;
  focus0: Element | null;
  target: Element | null;
  checked0?: boolean | null;
};

/** Start recording the first DOM change outside the ignored regions (see the two steps below). */
async function armMutationWatch(page: Page, target: Locator, ignoredRoots: string[]): Promise<{ quiet: boolean }> {
  // 1. Wait for a quiet 200 ms (up to ~1 s), so a background re-render is not credited to the
  //    click — and so the control is resolved only after any pending re-render replaced it.
  const quiet = await page.evaluate(async (ignored) => {
    const isIgnored = (node: Node | null): boolean => {
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      return !!el && ignored.some((selector) => !!el.closest(selector));
    };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let changed = false;
      const observer = new MutationObserver((records) => { if (records.some((r) => !isIgnored(r.target))) changed = true; });
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
      await new Promise((resolve) => setTimeout(resolve, 200));
      observer.disconnect();
      if (!changed) return true;
    }
    return false;
  }, ignoredRoots);

  // 2. Resolve the control now, and start watching.
  const handle = await target.elementHandle({ timeout: 1_000 }).catch(() => null);
  await page.evaluate(({ ignored, element }) => {
    type ClickWatchShape = {
      observer: MutationObserver; firstAt: number | null; evidence: string | null;
      t0: number; focus0: Element | null; target: Element | null; checked0?: boolean | null;
    };
    const w = window as unknown as { __uiClickWatch?: ClickWatchShape };
    const describe = (node: Node): string => {
      const el = node instanceof Element ? node : node.parentElement;
      if (!el) return '?';
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join('.')}` : ''}`;
    };
    const isIgnored = (node: Node | null): boolean => {
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      return !!el && ignored.some((selector) => !!el.closest(selector));
    };
    w.__uiClickWatch?.observer.disconnect();
    const el = element as Element | null;
    const watch: ClickWatchShape = {
      observer: null as unknown as MutationObserver,
      firstAt: null, evidence: null, t0: performance.now(),
      focus0: document.activeElement, target: el,
      checked0: el && 'checked' in (el as HTMLInputElement) ? (el as HTMLInputElement).checked : null,
    };
    watch.observer = new MutationObserver((records) => {
      if (watch.firstAt !== null) return;
      const hit = records.find((record) => !isIgnored(record.target));
      if (!hit) return;
      watch.firstAt = performance.now();
      watch.evidence = `${hit.type}${hit.attributeName ? `[${hit.attributeName}]` : ''} on ${describe(hit.target)}`;
    });
    watch.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    w.__uiClickWatch = watch;
  }, { ignored: ignoredRoots, element: handle });
  await handle?.dispose().catch(() => undefined);
  return { quiet };
}

async function readMutationWatch(page: Page): Promise<{ latencyMs: number | null; evidence: string | null; focusMoved: boolean }> {
  return page.evaluate(() => {
    const watch = (window as unknown as { __uiClickWatch?: ClickWatch }).__uiClickWatch;
    if (!watch) return { latencyMs: null, evidence: null, focusMoved: false };
    const target = watch.target as (HTMLInputElement | HTMLSelectElement | null);
    // A checkbox/radio whose tick changed reacted visibly even without an attribute mutation.
    if (watch.firstAt === null && target && 'checked' in target && watch.checked0 !== undefined
      && (target as HTMLInputElement).checked !== watch.checked0) {
      watch.firstAt = performance.now();
      watch.evidence = 'checked state changed';
    }
    // Focus counts only where focus itself is the visible reaction: a native picker or a caret —
    // on the tapped field, or on a field the tap moved focus to (e.g. "Tags" focuses a filter).
    const isField = (el: Element | null): boolean => !!el && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
      || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes((el as HTMLInputElement).type)));
    const active = document.activeElement;
    const fieldFocus = isField(active) && (active === target || active !== watch.focus0);
    return {
      latencyMs: watch.firstAt === null ? null : Math.round(watch.firstAt - watch.t0),
      evidence: watch.evidence,
      focusMoved: fieldFocus,
    };
  });
}

/**
 * Click `target` and wait up to `deadlineMs` for a visible reaction. Never throws on "no
 * reaction" — the caller decides (sweeps collect, targeted regressions assert).
 */
export async function clickAndMeasure(
  page: Page,
  target: Locator,
  options: { deadlineMs?: number; lateWindowMs?: number; ignoredMutationRoots?: string[] } = {},
): Promise<ClickResponse> {
  const deadlineMs = options.deadlineMs ?? UI_RESPONSE_DEADLINE_MS;
  const ignored = [...DEFAULT_IGNORED_MUTATION_ROOTS, ...(options.ignoredMutationRoots ?? [])];
  const { quiet } = await armMutationWatch(page, target, ignored);
  await readMainThreadProbe(page, { reset: true });

  let via: string | null = null;
  let started = Date.now();
  const onDialog = (): void => { via ??= 'dialog'; };
  const onPopup = (): void => { via ??= 'popup'; };
  const onDownload = (): void => { via ??= 'download'; };
  const onFileChooser = (): void => { via ??= 'filechooser'; };
  page.on('dialog', onDialog);
  page.on('popup', onPopup);
  page.on('download', onDownload);
  page.on('filechooser', onFileChooser);
  try {
    // Playwright's own actionability wait (visible, stable, not covered) is not the app's
    // latency; under CPU load it alone can exceed the budget. Freezes are caught by the probe.
    await target.click({ timeout: Math.max(deadlineMs, 3_000) });
    const clickedAt = Date.now();
    let watch = await readMutationWatch(page);
    if (watch.latencyMs === null) started = clickedAt;
    while (!via && watch.latencyMs === null && !watch.focusMoved && Date.now() - started < deadlineMs) {
      await page.waitForTimeout(25);
      watch = await readMutationWatch(page);
    }
    if (!via && watch.latencyMs !== null) via = 'dom';
    if (!via && watch.focusMoved) via = 'field-focus';
    let lateMs: number | null = null;
    if (!via && (options.lateWindowMs ?? UI_LATE_WINDOW_MS) > 0) {
      const lateDeadline = started + deadlineMs + (options.lateWindowMs ?? UI_LATE_WINDOW_MS);
      while (watch.latencyMs === null && !watch.focusMoved && Date.now() < lateDeadline) {
        await page.waitForTimeout(50);
        watch = await readMutationWatch(page);
      }
      if (watch.latencyMs !== null || watch.focusMoved) lateMs = watch.latencyMs ?? Date.now() - started;
    }
    let evidence = watch.evidence;
    if (!via && lateMs === null) {
      // Say why nothing happened: what sits on top of the control, and whether the element
      // that was clicked is still the one in the page.
      evidence = await page.evaluate(() => {
        const watched = (window as unknown as { __uiClickWatch?: ClickWatch }).__uiClickWatch?.target;
        if (!watched) return 'target lost';
        if (!watched.isConnected) return 'clicked element was replaced';
        const rect = watched.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const name = (el: Element | null): string => el ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}` : 'nothing';
        return top === watched || (top && watched.contains(top)) ? 'tap reached the control; it did nothing visible' : `covered by ${name(top)}`;
      }).catch(() => 'page did not answer');
    }
    return {
      clicked: true,
      responded: via !== null,
      via,
      latencyMs: via === 'dom' ? watch.latencyMs : via ? Date.now() - started : null,
      lateMs,
      evidence,
      quietBefore: quiet,
      mainThread: await readMainThreadProbe(page),
    };
  } catch {
    // Not clickable within the deadline: covered by an overlay, detached, or the page is frozen.
    const covering = await target.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!top || top === el || el.contains(top)) return null;
      return `covered by ${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ''}${typeof top.className === 'string' && top.className ? `.${top.className.split(' ')[0]}` : ''}`;
    }, undefined, { timeout: 1_000 }).catch(() => 'detached or page not answering');
    return {
      clicked: false, responded: false, via: null, latencyMs: null, lateMs: null, evidence: covering,
      quietBefore: quiet, mainThread: await readMainThreadProbe(page),
    };
  } finally {
    page.off('dialog', onDialog);
    page.off('popup', onPopup);
    page.off('download', onDownload);
    page.off('filechooser', onFileChooser);
  }
}

/** Assert form for targeted regressions: the click must produce a reaction and no freeze. */
export async function expectClickResponds(
  page: Page,
  target: Locator,
  label: string,
  options: { deadlineMs?: number; ignoredMutationRoots?: string[] } = {},
): Promise<ClickResponse> {
  const result = await clickAndMeasure(page, target, options);
  expect(result.responded, `${label}: no visible reaction within ${options.deadlineMs ?? UI_RESPONSE_DEADLINE_MS} ms`).toBe(true);
  expect(result.mainThread.maxGapMs, `${label}: main thread frozen for ${result.mainThread.maxGapMs} ms`).toBeLessThan(UI_FREEZE_GAP_MS);
  return result;
}

/* ── Sweeps ────────────────────────────────────────────────────────────────────────── */

/** Selector for anything a user can tap. */
export const CLICKABLE_SELECTOR = [
  'button',
  '[role="button"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="switch"]',
  'a[href]',
  'summary',
  'label[for]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'select',
  '[data-action]',
  '[data-testid$="-btn"]',
  '.nav-btn',
  '.settings-jump-menu-item',
].join(', ');

/**
 * Never clicked by a sweep: identity- or data-destroying actions, actions that leave the app,
 * and controls whose effect is to rewrite every label on the page (keys would stop matching).
 * Each one has (or needs) its own targeted spec — see the test plan's "Excluded from sweeps".
 */
export const SWEEP_DENYLIST = [
  '[data-testid*="erase"]',
  '[id*="erase"]',
  '[data-testid*="lock-identity"]',
  '[id*="lock-identity"]',
  '[data-testid*="remove-password"]',
  '[data-testid*="unlink"]',
  '[data-testid*="logout"]',
  '#settings-ui-language',
  'input[type="file"]',
  'a[target="_blank"]',
  'a[download]',
  '[disabled]',
  '[aria-disabled="true"]',
  // Re-selecting the selected radio is correctly a no-op.
  'input[type="radio"]:checked',
];

export interface SweepFailure {
  surface: string;
  key: string;
  label: string;
  reason: 'no-reaction' | 'late' | 'frozen' | 'not-clickable';
  detail: string;
}

export interface SweepReport {
  surface: string;
  /** Every control discovered on the starting screen, as `key — label`. */
  discovered: string[];
  /** One line per click: key, how it reacted, latency and the first change seen. */
  responses: string[];
  clicked: number;
  failures: SweepFailure[];
  slow: Array<{ key: string; label: string; latencyMs: number }>;
}

/** A stable handle for a control that survives re-renders (no text — labels are translated). */
async function listClickableKeys(page: Page, scope: string, deny: string[]): Promise<Array<{ key: string; label: string }>> {
  return page.evaluate(
    ({ scopeSelector, clickable, denied }) => {
      const root = document.querySelector(scopeSelector);
      if (!root) return [];
      const visible = (element: Element): boolean => {
        const style = getComputedStyle(element);
        if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1;
      };
      const pathKey = (element: Element): string => {
        const parts: string[] = [];
        let node: Element | null = element;
        while (node && node !== document.body) {
          if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
          const testId = node.getAttribute('data-testid');
          if (testId) { parts.unshift(`[data-testid="${CSS.escape(testId)}"]`); break; }
          const parent: Element | null = node.parentElement;
          const index = parent ? Array.from(parent.children).filter((child) => child.tagName === node!.tagName).indexOf(node) + 1 : 1;
          parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
          node = parent;
        }
        return parts.join(' > ');
      };
      const out: Array<{ key: string; label: string }> = [];
      const seen = new Set<string>();
      for (const element of Array.from(root.querySelectorAll(clickable))) {
        if (!visible(element)) continue;
        if (denied.some((selector) => element.matches(selector) || !!element.closest(selector))) continue;
        // A nested clickable inside another clickable (icon span inside a button) is the same tap.
        const outer = element.parentElement?.closest(clickable);
        if (outer && root.contains(outer) && outer !== element) continue;
        const key = pathKey(element);
        if (seen.has(key)) continue;
        seen.add(key);
        const label = (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '')
          .replace(/\s+/g, ' ').trim().slice(0, 60);
        out.push({ key, label });
      }
      return out;
    },
    { scopeSelector: scope, clickable: CLICKABLE_SELECTOR, denied: deny },
  );
}

/**
 * Click every visible control inside `scope`, one at a time, calling `restore()` before each
 * click so every control is tried from the same starting screen. Controls are discovered once,
 * from the starting screen; a control that cannot be found again after `restore()` is skipped.
 */
export async function sweepClickables(
  page: Page,
  options: {
    surface: string;
    scope: string;
    restore: () => Promise<void>;
    deny?: string[];
    deadlineMs?: number;
    ignoredMutationRoots?: string[];
    /** Only these keys (substring match) — for bisecting a failure. */
    only?: string[];
  },
): Promise<SweepReport> {
  const deny = [...SWEEP_DENYLIST, ...(options.deny ?? [])];
  await options.restore();
  let controls = await listClickableKeys(page, options.scope, deny);
  if (options.only?.length) controls = controls.filter((c) => options.only!.some((part) => c.key.includes(part)));

  const report: SweepReport = {
    surface: options.surface,
    discovered: controls.map((control) => `${control.key} — ${control.label}`),
    responses: [],
    clicked: 0,
    failures: [],
    slow: [],
  };
  for (const control of controls) {
    await options.restore();
    const target = page.locator(control.key).first();
    if (!(await target.isVisible().catch(() => false))) continue;
    if (await target.isDisabled().catch(() => false)) continue;
    const result = await clickAndMeasure(page, target, {
      ...(options.deadlineMs !== undefined ? { deadlineMs: options.deadlineMs } : {}),
      ...(options.ignoredMutationRoots ? { ignoredMutationRoots: options.ignoredMutationRoots } : {}),
    });
    report.clicked += 1;
    report.responses.push(
      `${control.key} — ${result.via ?? (result.lateMs !== null ? `LATE ${result.lateMs} ms` : 'NONE')}`
      + `${result.latencyMs !== null ? ` ${result.latencyMs} ms` : ''}`
      + `${result.evidence ? ` (${result.evidence})` : ''}${result.quietBefore ? '' : ' [noisy page]'}`,
    );
    if (result.mainThread.maxGapMs >= UI_FREEZE_GAP_MS) {
      report.failures.push({
        surface: options.surface,
        key: control.key,
        label: control.label,
        reason: 'frozen',
        detail: `main thread gap ${result.mainThread.maxGapMs} ms, long tasks ${result.mainThread.longTasksMs.join(',') || 'none'}`,
      });
    } else if (!result.responded) {
      report.failures.push({
        surface: options.surface,
        key: control.key,
        label: control.label,
        reason: !result.clicked ? 'not-clickable' : result.lateMs !== null ? 'late' : 'no-reaction',
        detail: result.clicked
          ? (result.lateMs !== null
            ? `first reaction after ${result.lateMs} ms (${result.evidence ?? '?'}) — over the ${options.deadlineMs ?? UI_RESPONSE_DEADLINE_MS} ms budget`
            : `no reaction within ${(options.deadlineMs ?? UI_RESPONSE_DEADLINE_MS) + UI_LATE_WINDOW_MS} ms`)
          : `could not be clicked within 3 s (${result.evidence ?? 'covered, detached or frozen'})`,
      });
    } else if ((result.latencyMs ?? 0) > 300) {
      report.slow.push({ key: control.key, label: control.label, latencyMs: result.latencyMs ?? 0 });
    }
    // Leave nothing behind for the next control: close a dialog or overlay it opened.
    await page.keyboard.press('Escape').catch(() => undefined);
  }
  return report;
}

export function formatSweepFailures(reports: SweepReport[]): string {
  const lines: string[] = [];
  for (const report of reports) {
    for (const failure of report.failures) {
      lines.push(`[${failure.surface}] ${failure.reason}: "${failure.label}" (${failure.key}) — ${failure.detail}`);
    }
  }
  return lines.join('\n');
}
