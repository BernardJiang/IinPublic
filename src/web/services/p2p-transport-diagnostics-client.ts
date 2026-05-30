import type { ConversationTransportMode } from '../../shared/p2p-runtime';

export async function reportTransportDiagnostic(
  apiBase: string,
  mode: ConversationTransportMode,
  fallbackReason: string | null,
): Promise<void> {
  try {
    await fetch(`${apiBase}/api/p2p/transport-diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, fallbackReason }),
    });
  } catch {
    // diagnostics are best-effort
  }
}
