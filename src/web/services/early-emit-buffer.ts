import type { EventEmitter } from 'events';

/**
 * Holds UI events emitted before anything listens to them, and delivers them once `release()` is
 * called. The app registers its handlers at the end of boot; until then an `emit()` with no
 * listener was silently dropped — a tap on Save or Send in the first seconds after launch did
 * nothing (docs/testing/gui-responsiveness-audit.md F1). Events that already have a listener pass
 * straight through. At most `limit` events are held.
 */
export function bufferEmitsUntilReleased(emitter: EventEmitter, limit = 200): () => void {
  const original = emitter.emit;
  const held: Array<[string | symbol, unknown[]]> = [];
  emitter.emit = function emitOrHold(this: EventEmitter, event: string | symbol, ...args: unknown[]): boolean {
    if (emitter.listenerCount(event) > 0) return original.call(emitter, event, ...args);
    if (held.length < limit) held.push([event, args]);
    return true;
  } as EventEmitter['emit'];
  let released = false;
  return () => {
    if (released) return;
    released = true;
    emitter.emit = original;
    for (const [event, args] of held.splice(0)) original.call(emitter, event, ...args);
  };
}
