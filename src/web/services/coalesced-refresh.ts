/**
 * A refresh that reads a whole list from the device core (the incoming rows, the answer history):
 * one read at a time, and calls made while one runs share a single further read after `gapMs`.
 * Every arrival and answer asks for these; on a phone each read walks every record and takes
 * seconds, and side-by-side or back-to-back reads kept the core busy for minutes during the
 * five-phone starter tags (2026-11-21), starving the exchange itself.
 */
export function coalesced<T>(run: () => Promise<T>, gapMs: number, combine: (earlier: T, later: T) => T = (_earlier, later) => later): () => Promise<T> {
  let running: Promise<T> | null = null;
  let again = false;
  return () => {
    if (running) { again = true; return running; }
    const current = (async () => {
      let result: T | undefined;
      let first = true;
      for (;;) {
        again = false;
        const next = await run();
        result = first ? next : combine(result as T, next);
        first = false;
        if (!again) return result;
        await new Promise((resolve) => setTimeout(resolve, gapMs));
      }
    })().finally(() => { if (running === current) running = null; });
    running = current;
    return current;
  };
}
