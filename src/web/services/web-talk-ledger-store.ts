/**
 * src/web/services/web-talk-ledger-store.ts
 *
 * Thin localStorage wrapper for TalkLedgerDoc.
 *
 * Design ref: docs/design/p0-steps8-11-ledger.md §1
 *
 * Delegates ALL ordering / eviction logic to src/shared/talk-ledger.ts.
 * This module only handles:
 *   - load / save (JSON to/from localStorage key "talkLedger")
 *   - apply (load → applyEvent → save, returned updated doc)
 *   - applyEdgeGateForPeer (load → applyEdgeGate → save, returned gate result)
 *   - read helpers (shouldSuppressForPeer, getDoc)
 */

import {
  emptyTalkLedgerDoc,
  applyEvent,
  applyEdgeGate,
  shouldSuppress,
  type TalkLedgerDoc,
  type LedgerEvent,
} from '../../shared/talk-ledger';

const STORAGE_KEY = 'talkLedger';

// ─── Load / save ───────────────────────────────────────────────────────────────

export function loadTalkLedger(): TalkLedgerDoc {
  if (typeof localStorage === 'undefined') return emptyTalkLedgerDoc();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTalkLedgerDoc();
    const parsed = JSON.parse(raw) as Partial<TalkLedgerDoc>;
    return {
      version: 1,
      outcomes: parsed.outcomes && typeof parsed.outcomes === 'object' ? parsed.outcomes : {},
      exchanged: parsed.exchanged && typeof parsed.exchanged === 'object' ? parsed.exchanged : {},
      edges: parsed.edges && typeof parsed.edges === 'object' ? parsed.edges : {},
      retracted: parsed.retracted && typeof parsed.retracted === 'object' ? parsed.retracted : {},
    };
  } catch {
    return emptyTalkLedgerDoc();
  }
}

export function saveTalkLedger(doc: TalkLedgerDoc): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage quota exceeded — silently ignore (losing an entry costs one redundant send)
  }
}

// ─── Transaction helpers ───────────────────────────────────────────────────────

/**
 * Apply a ledger event: load → applyEvent → save.
 * Returns the updated doc (may be the same reference if event was rejected).
 */
export function applyTalkLedgerEvent(event: LedgerEvent): TalkLedgerDoc {
  const doc = loadTalkLedger();
  const updated = applyEvent(doc, event);
  saveTalkLedger(updated);
  return updated;
}

/**
 * Apply an edge gate check for outbound send to `peerId` at `nowMs`.
 * If the gate passes, debit counters and save; otherwise return the rejection reasons.
 */
export function applyEdgeGateForPeer(
  peerId: string,
  nowMs: number,
): { ok: boolean; rejectedBy: string[] } {
  const doc = loadTalkLedger();
  const result = applyEdgeGate(doc, peerId, nowMs);
  if (result.ok) {
    saveTalkLedger(doc);
  }
  return result;
}

/**
 * Check whether the sender should skip `peerId` for a talk with `identityKey`.
 * Pure read — no side effects.
 */
export function shouldSuppressForPeer(peerId: string, identityKey: string): boolean {
  const doc = loadTalkLedger();
  return shouldSuppress(doc, peerId, identityKey);
}

/**
 * Read the current doc without modification.
 */
export function getTalkLedgerDoc(): TalkLedgerDoc {
  return loadTalkLedger();
}
