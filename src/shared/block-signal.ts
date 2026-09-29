import { CONFIG } from './config';
import type { KnownPerson, ReceivedBlockSignals, SharedBlockSignals } from './types';
import { resolveContactGroupUserIds } from './contact-groups';

/**
 * Friend-circle block signal — lets a viewer's own contacts anonymously (to the server, to each
 * other, and to the viewer beyond a bare count) flag an identity they've blocked. Once at least
 * BLOCK_SIGNAL_THRESHOLD of the viewer's own contacts have sent a signal about the same
 * identity, the viewer's UI shows a soft warning. See user-detail-view.ts for where this
 * surfaces, and app.ts's fanOutBlockSignal/ingestBlockSignalFromMailbox for the pairwise
 * mailbox-encrypted send/receive path — there is no one-to-many encryption primitive in this
 * codebase, so "notify my contacts" is N pairwise sends, one per contact.
 *
 * A block-share is a STATUS, not a one-time push: the sender persists which group scope they
 * shared each blocked identity with (SharedBlockSignals, below). Whenever a NEW contact is
 * added or relabeled and now qualifies for a previously-shared scope, the sender re-sends —
 * catching them up on shares that happened before they joined that scope. See app.ts's
 * resendSharedBlockSignalsToNewContact and the 'saveKnownPerson' handler that calls it.
 *
 * Modeled on src/shared/contact-groups.ts's resolveContactGroupUserIds idiom: pure, on-device,
 * no network calls, no server involvement in the aggregation itself.
 */

/** Reuses the existing age-verification threshold constant — one source of truth for "3". */
export const BLOCK_SIGNAL_THRESHOLD = CONFIG.AGE_VERIFICATION_THRESHOLD;

export const BLOCK_SIGNAL_PAYLOAD_KIND = 'block-signal-v1' as const;

export interface BlockSignalPayload {
  kind: typeof BLOCK_SIGNAL_PAYLOAD_KIND;
  /** The identity the sender has blocked. */
  targetIdentity: string;
  /** ISO timestamp, sender-supplied. */
  at: string;
  /** Sender-generated id, used only for local dedup on the receiving side — never re-exposed. */
  signalId: string;
}

export type { ReceivedBlockSignals, SharedBlockSignals };

export function countReceivedBlockSignals(
  received: ReceivedBlockSignals | undefined,
  targetIdentity: string,
): number {
  if (!received || !targetIdentity) return 0;
  return (received[targetIdentity] || []).length;
}

export function meetsBlockSignalThreshold(
  received: ReceivedBlockSignals | undefined,
  targetIdentity: string,
): boolean {
  return countReceivedBlockSignals(received, targetIdentity) >= BLOCK_SIGNAL_THRESHOLD;
}

/**
 * Dedup-safe insert — does not mutate the input map. A resend of the same signalId (e.g. a
 * mailbox retry) is a no-op, not a double-count.
 */
export function recordBlockSignal(
  received: ReceivedBlockSignals | undefined,
  targetIdentity: string,
  signalId: string,
): ReceivedBlockSignals {
  const base = received || {};
  if (!targetIdentity || !signalId) return base;
  const existing = base[targetIdentity] || [];
  if (existing.includes(signalId)) return base;
  return { ...base, [targetIdentity]: [...existing, signalId] };
}

/**
 * Records (or overwrites) the current share scope for one blocked identity — "last write wins",
 * matching the "status, not a log" framing: a target has at most one active share scope at a
 * time. Does not mutate the input map.
 */
export function recordSharedBlockSignal(
  shared: SharedBlockSignals | undefined,
  targetIdentity: string,
  groupId: string,
  signalId: string,
): SharedBlockSignals {
  const base = shared || {};
  if (!targetIdentity || !groupId || !signalId) return base;
  return { ...base, [targetIdentity]: { groupId, signalId, sharedAt: new Date().toISOString() } };
}

/**
 * Pure "catch-up" check: given the sender's persisted share scopes and one contact (as they
 * exist right now — current labels), which previously-shared targets does this contact newly
 * qualify to receive? Reuses resolveContactGroupUserIds's own group-matching rule (including
 * 'all') so a contact freshly labeled 'coworker' matches a share scoped to 'coworker' even
 * though the share happened before this contact was added or relabeled.
 */
export function resolveSharedSignalsForContact(
  shared: SharedBlockSignals | undefined,
  contact: KnownPerson,
): Array<{ targetIdentity: string; signalId: string }> {
  if (!shared || !contact?.userId) return [];
  const matches: Array<{ targetIdentity: string; signalId: string }> = [];
  for (const [targetIdentity, share] of Object.entries(shared)) {
    const recipients = resolveContactGroupUserIds([contact], share.groupId, []);
    if (recipients.includes(contact.userId)) {
      matches.push({ targetIdentity, signalId: share.signalId });
    }
  }
  return matches;
}
