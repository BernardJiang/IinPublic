/**
 * `fetch` that gives up after `timeoutMs`. A request with no timeout on a hung network (Wi-Fi
 * with no internet, a captive portal, a dead cell) never settles, and any tap that awaits it looks
 * dead (docs/testing/gui-responsiveness-audit.md, F16). Rejects with an `AbortError` on timeout.
 *
 * Uses AbortController + setTimeout rather than `AbortSignal.timeout`, which older Android
 * WebViews lack. A caller's own `init.signal` still aborts the request too.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const outer = init.signal;
  const onOuterAbort = (): void => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onOuterAbort, { once: true });
  }
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuterAbort);
  }
}
