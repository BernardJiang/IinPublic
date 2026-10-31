import type { ConversationTransportMode } from '../../shared/p2p-runtime';

import { fetchWithTimeout } from './fetch-with-timeout';

/** Every hub call here gives up after 5 s (docs/testing/gui-responsiveness-audit.md F16). */
const boundedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => fetchWithTimeout(input, init, 5_000);
export async function reportTransportDiagnostic(
  apiBase: string,
  mode: ConversationTransportMode,
  fallbackReason: string | null,
): Promise<void> {
  try {
    await boundedFetch(`${apiBase}/api/p2p/transport-diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, fallbackReason }),
    });
  } catch {
    // diagnostics are best-effort
  }
}
