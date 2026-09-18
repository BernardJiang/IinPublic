/**
 * HTTP fallback for a small allowlist of Gun paths that must reach a real cross-device peer even
 * when this device is a native/embedded build (Android/iOS/Electron, `src/node-app/embedded-node.ts`).
 *
 * Found via a real-hardware test (10-android-macmini-device-sync-conversation-merge.spec.ts):
 * an embedded node dials the public hub "for discovery only" (embedded-node.ts's own doc
 * comment) — its local Gun graph is NOT a generic peer of the hub's graph, only a narrow,
 * hand-picked allowlist of paths gets explicit HTTP relay (chatroom membership, signaling,
 * public users, TURN, TechSupport messages — see `EmbeddedHubRelayClientLike`). Every path below
 * is a *new* one (identity-linking, WP5 device-sync) that was only ever exercised
 * browser-to-browser before, so it silently never reached a real embedded device — same root
 * cause, same fix shape, as the four K7 relay bugs found the same way
 * (`docs/design/techsupport-k7-design-note.md`; [[project_techsupport_rollout]]).
 *
 * These calls are additive, not a replacement: the caller's own raw Gun read/write remains —
 * cheap and correct for an ordinary browser, which IS a generic Gun peer of the server it talks
 * to. This is purely the safety net for when that Gun path doesn't (yet, or ever, on this
 * platform) actually reach the other device. Every call here is best-effort: it must never make
 * a caller that already worked via Gun start failing because the relay endpoint is unreachable
 * (offline embedded node, or a browser dev server without `/api/relay/graph` wired up).
 */

const ALLOWED_RELAY_ROOTS = new Set([
  'identity-link-requests',
  'identity-links',
  'identity-link-revocations',
  'device-sync-authorization',
  'device-sync-epub',
  'device-sync-envelope',
  'device-sync-ack',
]);

function relayUrl(apiBase: string, path: string): string {
  const segments = path.split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2 || segments.length > 3 || !ALLOWED_RELAY_ROOTS.has(segments[0])) {
    throw new Error(`graph relay: unsupported path "${path}"`);
  }
  return `${apiBase.replace(/\/+$/, '')}/api/relay/graph/${segments.map(encodeURIComponent).join('/')}`;
}

/** Best-effort — never throws. The caller's own Gun write already applied to its local graph. */
export async function putGraphRelay(apiBase: string, path: string, data: unknown): Promise<void> {
  try {
    await fetch(relayUrl(apiBase, path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
  } catch {
    // Offline embedded node, or a dev origin without this route — nothing more to do here.
  }
}

/** Best-effort — resolves to `null` (never throws) on any failure. */
export async function getGraphRelay<T = unknown>(apiBase: string, path: string): Promise<T | null> {
  try {
    const response = await fetch(relayUrl(apiBase, path));
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: T | null };
    return body.data ?? null;
  } catch {
    return null;
  }
}
