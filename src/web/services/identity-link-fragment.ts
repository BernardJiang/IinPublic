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
import { readNativeHostInfo } from '../ui/native-host-info';

const LINK_FRAGMENT_PREFIX = '#link=';

const PUBLIC_WEB_ORIGIN = 'https://www.iinpublic.com';

/**
 * Build the shareable link-fragment URL for a generated pairing code. A native shell serves the
 * bundle from its own loopback node (`?native_platform=` / `window.iinpublicNative`, see
 * native-host-info.ts) — that origin means nothing on another device, so native builds point
 * at the public site instead.
 */
export function buildLinkFragmentUrl(code: string): string {
  const base = readNativeHostInfo().platform !== 'web'
    ? `${PUBLIC_WEB_ORIGIN}/`
    : `${window.location.origin}${window.location.pathname}`;
  return `${base}${LINK_FRAGMENT_PREFIX}${encodeURIComponent(code)}`;
}

/**
 * Remote-friendly hand-off: share the link (and the raw code, for a recipient running the
 * native app, which can't open a web fragment) through the OS share sheet — any messenger or
 * email to yourself works, no physical proximity needed. Falls back to copying the same text.
 * Returns how it was delivered, or null if neither path was available.
 */
export async function shareLinkCode(code: string, message: string): Promise<'shared' | 'copied' | null> {
  const url = buildLinkFragmentUrl(code);
  const text = `${message}\n${code}`;
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text, url });
      return 'shared';
    } catch (error) {
      // The person dismissed the sheet — not an error, and not a reason to copy instead.
      if ((error as { name?: string })?.name === 'AbortError') return null;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    return 'copied';
  } catch {
    return null;
  }
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
