/** Android's JavascriptInterface is synchronous even when its Kotlin method performs I/O.
 * Request the native journal on its executor and receive it as a WebView event instead. */
export interface NativeBackgroundEventsBridge {
  requestEvents?: (requestId: string) => boolean;
  acknowledgeAsync?: (idsJson: string) => boolean;
}

let nextRequest = 0;

export function readNativeBackgroundEvents(
  bridge: NativeBackgroundEventsBridge,
  timeoutMs = 60_000,
): Promise<unknown[]> {
  if (typeof bridge.requestEvents !== 'function') return Promise.resolve([]);
  const requestId = `events_${Date.now()}_${++nextRequest}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (events: unknown[]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('iinpublic-background-agent-events', receive);
      resolve(events);
    };
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; payload?: string }>).detail;
      if (detail?.id !== requestId) return;
      try {
        const parsed = JSON.parse(detail.payload || '{}');
        finish(Array.isArray(parsed?.events) ? parsed.events : []);
      } catch {
        finish([]);
      }
    };
    window.addEventListener('iinpublic-background-agent-events', receive);
    const timer = window.setTimeout(() => finish([]), timeoutMs);
    try {
      if (!bridge.requestEvents!(requestId)) finish([]);
    } catch {
      finish([]);
    }
  });
}
