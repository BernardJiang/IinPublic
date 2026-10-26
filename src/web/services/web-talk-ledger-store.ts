/**
 * src/web/services/web-talk-ledger-store.ts
 *
 * Thin wrapper for TalkLedgerDoc over the device core (OPEN-91 P3): each record is one entry of the
 * `talkLedger` collection (`<section>::<key>`), so a save writes only the records that changed; it
 * was one localStorage JSON document rewritten whole on every event.
 *
 * Design ref: docs/design/p0-steps8-11-ledger.md §1
 *
 * Delegates ALL ordering / eviction logic to src/shared/talk-ledger.ts.
 * This module only handles:
 *   - load / save (the doc to/from the core collection's view)
 *   - apply (load → applyEvent → save, returned updated doc)
 *   - applyEdgeGateForPeer (load → applyEdgeGate → save, returned gate result)
 *   - read helpers (shouldSuppressForPeer, getDoc)
 */

import {
  emptyTalkLedgerDoc,
  applyEvent,
  applyEdgeGate,
  shouldSuppress,
  exchangedKey,
  type TalkLedgerDoc,
  type LedgerEvent,
  type ExchangedEntry,
} from '../../shared/talk-ledger';
import { TALK_LEDGER_SECTIONS, talkLedgerView } from './core-views';

type Section = typeof TALK_LEDGER_SECTIONS[number];

// ─── Load / save ───────────────────────────────────────────────────────────────

/** The doc, rebuilt from the view; a copy, since the ledger functions change it in place. */
export function loadTalkLedger(): TalkLedgerDoc {
  const doc = emptyTalkLedgerDoc() as TalkLedgerDoc & Record<Section, Record<string, unknown>>;
  for (const [entryKey, value] of Object.entries(talkLedgerView.all())) {
    const split = entryKey.indexOf('::');
    const section = entryKey.slice(0, split) as Section;
    if (split < 0 || !(TALK_LEDGER_SECTIONS as readonly string[]).includes(section)) continue;
    doc[section] ??= {};
    doc[section][entryKey.slice(split + 2)] = JSON.parse(JSON.stringify(value));
  }
  return doc;
}

/** Writes the records that changed and removes the ones the doc no longer has (evictions). */
export function saveTalkLedger(doc: TalkLedgerDoc): void {
  const current = talkLedgerView.all();
  const next: Record<string, unknown> = {};
  for (const section of TALK_LEDGER_SECTIONS) {
    for (const [key, value] of Object.entries(((doc as Record<string, unknown>)[section] ?? {}) as Record<string, unknown>)) next[`${section}::${key}`] = value;
  }
  const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value)));
  talkLedgerView.set(JSON.parse(JSON.stringify(changed)));
  talkLedgerView.remove(Object.keys(current).filter((key) => !(key in next)));
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
  talkId?: string,
): { ok: boolean; rejectedBy: string[] } {
  const doc = loadTalkLedger();
  const result = applyEdgeGate(doc, peerId, nowMs, talkId);
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

// ─── Step 9: responder-side helpers ───────────────────────────────────────────

/**
 * Return the current version the responder (self) has sent for the given
 * (talkId, authorId) identity, or 0 if no prior response exists.
 *
 * We store the responder's own sent-response in the exchanged section with
 * role:'responder' and key `${authorId}::${identityKey}`.  The version field
 * on that entry mirrors the version sent.
 *
 * This is the persistent "what version did I last send?" for monotonic bumping.
 */
export function getResponderVersionForTalk(
  identityKey: string,
  authorId: string,
): number {
  const doc = loadTalkLedger();
  const key = exchangedKey(authorId, identityKey);
  const entry = doc.exchanged[key];
  if (!entry || entry.role !== 'responder') return 0;
  return entry.version;
}

/**
 * Write/update a responder-side exchanged entry recording that the responder
 * (self) has answered a talk with the given identityKey from authorId.
 *
 * Called from submitTalkResponsePairDirect after sending the response.
 * Stores version + responseId so change-of-mind fanout can read prior state.
 */
export function writeResponderExchangedEntry(params: {
  authorId: string;
  identityKey: string;
  talkId?: string;
  authorName?: string;
  authorEpub?: string;
  outcome: ExchangedEntry['outcome'];
  version: number;
  responseId: string;
  respondedAt: string;
}): void {
  const doc = loadTalkLedger();
  const key = exchangedKey(params.authorId, params.identityKey);
  const existing = doc.exchanged[key];
  // Only update if incoming version is >= existing (allow idempotent re-write at same version)
  if (existing && existing.role === 'responder' && existing.version > params.version) {
    return; // stale write — existing is newer
  }
  doc.exchanged[key] = {
    peerId: params.authorId,
    identityKey: params.identityKey,
    ...(params.talkId || existing?.talkId ? { talkId: params.talkId || existing?.talkId } : {}),
    ...(params.authorName || existing?.peerName ? { peerName: params.authorName || existing?.peerName } : {}),
    ...(params.authorEpub || existing?.peerEpub ? { peerEpub: params.authorEpub || existing?.peerEpub } : {}),
    outcome: params.outcome,
    version: params.version,
    role: 'responder',
    lastExchangedAt: params.respondedAt,
    // Extra field for change-of-mind fanout: store responseId so we can detect content change.
    // TypeScript: cast to any is required because ExchangedEntry doesn't have responseId.
    // We attach it as a non-schema field that fanout reads.
    ...(params.responseId ? { responseId: params.responseId } as any : {}),
  };
  saveTalkLedger(doc);
}

/**
 * Get all authorIds who have sent the responder a talk with this identityKey.
 * Used by change-of-mind fanout: enumerates all senders to propagate the update to.
 *
 * Returns an array of authorIds where `exchanged[authorId::identityKey].role === 'responder'`.
 */
export function getResponderSendersForIdentity(identityKey: string): string[] {
  const doc = loadTalkLedger();
  const senders: string[] = [];
  for (const entry of Object.values(doc.exchanged)) {
    if (entry.role === 'responder' && entry.identityKey === identityKey) {
      senders.push(entry.peerId);
    }
  }
  return senders;
}

export function getResponderTargetsForIdentity(identityKey: string): ExchangedEntry[] {
  const doc = loadTalkLedger();
  return Object.values(doc.exchanged).filter(
    (entry) => entry.role === 'responder' && entry.identityKey === identityKey,
  );
}

export function writeAuthorExchangedEntries(params: {
  responderId: string;
  identityKeys: string[];
  outcome: ExchangedEntry['outcome'];
  version: number;
  respondedAt: string;
}): void {
  const doc = loadTalkLedger();
  for (const identityKey of new Set(params.identityKeys.filter(Boolean))) {
    const key = exchangedKey(params.responderId, identityKey);
    const existing = doc.exchanged[key];
    if (existing && existing.version > params.version) continue;
    doc.exchanged[key] = {
      peerId: params.responderId,
      identityKey,
      outcome: params.outcome,
      version: params.version,
      role: 'author',
      lastExchangedAt: params.respondedAt,
    };
  }
  saveTalkLedger(doc);
}

/**
 * Get the responseId last sent by the responder for the given (authorId, identityKey).
 * Used to detect content change: if new responseId !== stored, version must bump.
 */
export function getResponderLastResponseId(
  identityKey: string,
  authorId: string,
): string | null {
  const doc = loadTalkLedger();
  const key = exchangedKey(authorId, identityKey);
  const entry = doc.exchanged[key];
  if (!entry || entry.role !== 'responder') return null;
  return (entry as any).responseId ?? null;
}

// ─── docs/TODO.md §W Gap 2: unified send-suppression ──────────────────────────

/**
 * Record that WE sent a talk to `peerId` — locally, no round-trip. This is the single write
 * every send path (room broadcast, contact-group broadcast, individual peer send) should call
 * right after a send is attempted, so `shouldSuppressForPeer` can suppress a resend even before
 * the recipient has answered.
 */
export function markTalkSentToPeer(params: {
  peerId: string;
  identityKey: string;
  talkId: string;
  sentAt?: string;
}): void {
  applyTalkLedgerEvent({
    kind: 'TALK_SENT',
    peerId: params.peerId,
    identityKey: params.identityKey,
    talkId: params.talkId,
    sentAt: params.sentAt ?? new Date().toISOString(),
  });
}
