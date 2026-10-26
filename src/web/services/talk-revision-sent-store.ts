/**
 * OPEN-45: which revision (`computeTalkRevisionHash`) of each authored talk each peer last
 * accepted. The delivery ledger suppresses by content identity, so this is what tells a title- or
 * routing-only edit apart from "already has it" and lets the edit go out as an in-place update.
 * Kept in the device core (OPEN-91, `talkRevisionSent`), bounded, best-effort (a lost record only
 * means one baseline is re-taken).
 */
import { talkRevisionSentView } from './core-views';

const MAX_ENTRIES = 2000;

const key = (peerId: string, talkId: string): string => `${peerId}::${talkId}`;

export function recordTalkRevisionSent(peerId: string, talkId: string, revision: string): void {
  if (!peerId || !talkId || !revision) return;
  talkRevisionSentView.set({ [key(peerId, talkId)]: { revision, at: Date.now() } });
  const entries = Object.entries(talkRevisionSentView.all());
  if (entries.length > MAX_ENTRIES) {
    talkRevisionSentView.remove(entries.sort((a, b) => b[1].at - a[1].at).slice(MAX_ENTRIES).map(([k]) => k));
  }
}

/**
 * True when the peer already has this talk's content but an older revision of it. With no record
 * yet (a talk delivered before revisions were tracked) nothing is owed; `baselineIfUnknown`
 * records the current revision then, so the NEXT edit is detected without a re-send storm now.
 */
export function talkRevisionOwedToPeer(
  peerId: string,
  talkId: string,
  revision: string,
  opts: { baselineIfUnknown?: boolean } = {},
): boolean {
  const known = talkRevisionSentView.get(key(peerId, talkId));
  if (!known) {
    if (opts.baselineIfUnknown) recordTalkRevisionSent(peerId, talkId, revision);
    return false;
  }
  return known.revision !== revision;
}
