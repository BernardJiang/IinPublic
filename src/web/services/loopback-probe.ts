/**
 * Same-device loopback discovery (docs/TODO.md §I, spec §10.3 "Same-device linking").
 *
 * The native/desktop "app" a browser tab can link with on one machine is not a separate
 * product — it is this same `src/server` code running in embedded-node mode, serving the
 * identical web bundle on `http://127.0.0.1:<port>` (see `embedded-node-config.ts`'s own
 * doc comment). "Loopback linking" therefore reduces to: can this browser tab reach a
 * local instance at all? If so, offer the one-click affordance; the actual code handoff
 * still travels through the ordinary `#link=<code>` URL-fragment mechanism
 * (`identity-link-fragment.ts`), opened programmatically instead of typed.
 *
 * Deliberately probes the already-public `/health` route rather than a new endpoint: a
 * loopback-scoped endpoint carrying pairing secrets would be a fresh CORS/security surface
 * (any web page could otherwise poll a user's local ports); reusing `/health` keeps this a
 * pure reachability check with no new attack surface.
 */

/** Default local port `embedded-node-config.ts` boots on unless overridden. */
export const DEFAULT_LOOPBACK_PORT = 8080;

/**
 * Resolve whether a local IinPublic node answers on `127.0.0.1:<port>`. Best-effort and
 * silent — a probe failure (no native app running, CORS-blocked, timed out) just means the
 * one-click affordance stays hidden, never an error surfaced to the user.
 */
export async function probeLoopbackNode(
  port: number = DEFAULT_LOOPBACK_PORT,
  timeoutMs = 800,
): Promise<boolean> {
  if (typeof fetch !== 'function') return false;
  try {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        method: 'GET',
        ...(controller ? { signal: controller.signal } : {}),
      });
      return res.ok;
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

/** The URL a loopback "link with the app on this computer" affordance opens. */
export function loopbackLinkUrl(code: string, port: number = DEFAULT_LOOPBACK_PORT): string {
  return `http://127.0.0.1:${port}/#link=${encodeURIComponent(code)}`;
}
