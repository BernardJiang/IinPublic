/**
 * URL-fragment same-device linking shortcut (docs/TODO.md §I, spec §10.3).
 *
 * A pairing code is safe to carry in a URL *fragment* specifically because the fragment
 * never leaves the browser — it is not sent to any server, not logged by a proxy, and not
 * included in the Referer header of a follow-on request. Opening
 * `https://iinpublic.com/#link=<code>` on the other device/tab therefore hands off the
 * one-time secret exactly as safely as the existing QR/typed-code paths, just without
 * manual transcription.
 */

import { decodePairingCode, type PairingPayload } from '../../shared/identity-linking';

const LINK_FRAGMENT_PREFIX = '#link=';

/** Build the shareable link-fragment URL for a generated pairing code. */
export function buildLinkFragmentUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}${LINK_FRAGMENT_PREFIX}${encodeURIComponent(code)}`;
}

/**
 * Parse a `#link=<code>` fragment into its raw code string, or null when the current URL
 * carries no (or a malformed) link fragment. Does not itself validate the payload —
 * callers that need a structurally-valid `PairingPayload` should also call
 * `decodePairingCode` (or use `parseLinkFragmentPayload` below).
 */
export function parseLinkFragment(hash: string): string | null {
  if (!hash.startsWith(LINK_FRAGMENT_PREFIX)) return null;
  const raw = hash.slice(LINK_FRAGMENT_PREFIX.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Parse and structurally validate the current URL's link fragment in one step. Returns
 * both the raw code (for prefilling the Enter-code dialog, which re-validates on submit
 * the same way a typed/scanned code does) and the decoded payload (for a lightweight
 * sanity check before popping a modal for what might just be an unrelated `#link=...`
 * hash on the page).
 */
export function parseLinkFragmentPayload(hash: string): { code: string; payload: PairingPayload } | null {
  const code = parseLinkFragment(hash);
  if (!code) return null;
  const payload = decodePairingCode(code);
  if (!payload) return null;
  return { code, payload };
}

/**
 * Remove the link fragment from the visible URL without a navigation/reload. The code is
 * a one-time secret (docs/TODO.md §I) — it must not linger in the URL bar, browser
 * history, or a screenshot/share of the current tab, and a page reload must not
 * re-trigger the linking prompt.
 */
export function clearLinkFragmentFromUrl(): void {
  const { pathname, search } = window.location;
  history.replaceState(null, '', pathname + search);
}
