/**
 * src/web/services/web-talk-ledger-store.ts
 *
 * Thin wrapper for TalkLedgerDoc over the device core (OPEN-91 P3): each record is one entry of the
 * `talkLedger` collection (`<section>::<key>`), so a save writes only the records that changed; it
 * was one localStorage JSON document rewritten whole on every event.
 *
 * Design ref: docs/design/p0-steps8-11-ledger.md §1
 *
 * Mutations are commands executed in sequence on the core's storage owner. This module flushes
 * legacy imports, sends commands and installs their committed snapshots. Synchronous read helpers
 * use the GUI's cached view; saveTalkLedger remains for legacy migration/test fixtures.
 */

import {
  emptyTalkLedgerDoc,
  talkLedgerQuotaUnlimited,
  shouldSuppress,
  exchangedKey,
  type TalkLedgerDoc,
  type LedgerEvent,
  type ExchangedEntry,
} from '../../shared/talk-ledger';
import { TALK_LEDGER_SECTIONS, talkLedgerView } from './core-views';
import type { LedgerCommand, LedgerCommandResult, AuthorEntriesInput, ResponderEntryInput, ResponseCommitInput, CommittedResponse } from '../../core/talk-ledger-store';
import type { CoreRequester } from './node-core-link';
import type { GunBridge } from './gun-bridge';

let requestCore: CoreRequester | null = null;
let commandQueue: Promise<unknown> = Promise.resolve();
let stopChanges: (() => void) | null = null;
let refreshPending = false;
let changeGeneration = 0;
export function connectTalkLedgerCore(request: CoreRequester, bridge?: GunBridge): void {
  requestCore = request;
  stopChanges?.();
  stopChanges = bridge?.onCoreCollectionChanged((collection) => {
    if (collection !== 'talkLedger' && collection !== '*') return;
    changeGeneration++;
    if (refreshPending) return;
    refreshPending = true;
    const refresh = commandQueue.then(async () => {
      try {
        let seen: number;
        do {
          seen = changeGeneration;
          await talkLedgerView.refresh();
        } while (seen !== changeGeneration);
      } finally { refreshPending = false; }
    });
    commandQueue = refresh.catch((error) => {
      if (!bridge.isClosed()) console.warn('[ledger] host view refresh failed:', error);
    });
  }) ?? null;
}
async function command(request: LedgerCommand): Promise<LedgerCommandResult> {
  const result = commandQueue.then(async () => {
    if (!requestCore) throw new Error('Talk ledger host is unavailable');
    await talkLedgerView.flush();
    const result = await requestCore(request) as LedgerCommandResult;
    talkLedgerView.acceptSnapshot(result.entries);
    return result;
  });
  commandQueue = result.catch(() => undefined);
  return result;
}

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
 * Apply a ledger event on the host and refresh this GUI's view.
 */
export async function applyTalkLedgerEvent(event: LedgerEvent): Promise<TalkLedgerDoc> {
  await command({ name: 'ledger.apply', event });
  return loadTalkLedger();
}

/**
 * Apply an edge gate check for outbound send to `peerId` at `nowMs`.
 * If the gate passes, debit counters and save; otherwise return the rejection reasons.
 */
export async function applyEdgeGateForPeer(peerId: string, nowMs: number, talkId?: string): Promise<{ ok: boolean; rejectedBy: string[] }> {
  return (await command({ name: 'ledger.gate', peerId, nowMs, unlimitedForTesting: talkLedgerQuotaUnlimited, ...(talkId ? { talkId } : {}) })).gate!;
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
export async function writeResponderExchangedEntry(input: ResponderEntryInput): Promise<void> {
  await command({ name: 'ledger.responder', input });
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

export async function writeAuthorExchangedEntries(input: AuthorEntriesInput): Promise<void> {
  await command({ name: 'ledger.author', input });
}

export async function recordAuthorAnswer(event: LedgerEvent, input: AuthorEntriesInput): Promise<void> {
  await command({ name: 'ledger.authorAnswer', event, input });
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
export async function markTalkSentToPeer(params: {
  peerId: string;
  identityKey: string;
  talkId: string;
  sentAt?: string;
}): Promise<void> {
  await applyTalkLedgerEvent({
    kind: 'TALK_SENT',
    peerId: params.peerId,
    identityKey: params.identityKey,
    talkId: params.talkId,
    sentAt: params.sentAt ?? new Date().toISOString(),
  });
}

/** Persist and version a response before its encrypted payload is passed to the transport. */
export async function commitTalkResponse(input: ResponseCommitInput): Promise<CommittedResponse> {
  return (await command({ name: 'response.commit', input })).response!;
}
