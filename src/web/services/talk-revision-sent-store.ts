/**
 * OPEN-40: which revision (`computeTalkRevisionHash`) of each authored talk each peer last
 * accepted. The delivery ledger suppresses by content identity, so this is what tells a title- or
 * routing-only edit apart from "already has it" and lets the edit go out as an in-place update.
 * Local, bounded, best-effort (a lost record only means one baseline is re-taken).
 */

const STORAGE_KEY = 'iinpublic_talk_revision_sent_v1';
const MAX_ENTRIES = 2000;

type RevisionMap = Record<string, { revision: string; at: number }>;

function read(): RevisionMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as RevisionMap) : {};
  } catch {
    return {};
  }
}

function write(map: RevisionMap): void {
  const entries = Object.entries(map);
  const bounded = entries.length > MAX_ENTRIES
    ? Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES))
    : map;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    /* best-effort */
  }
}

const key = (peerId: string, talkId: string): string => `${peerId}::${talkId}`;

export function recordTalkRevisionSent(peerId: string, talkId: string, revision: string): void {
  if (!peerId || !talkId || !revision) return;
  const map = read();
  map[key(peerId, talkId)] = { revision, at: Date.now() };
  write(map);
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
  const known = read()[key(peerId, talkId)];
  if (!known) {
    if (opts.baselineIfUnknown) recordTalkRevisionSent(peerId, talkId, revision);
    return false;
  }
  return known.revision !== revision;
}
