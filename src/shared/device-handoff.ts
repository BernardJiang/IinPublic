/**
 * Encrypted handoff archive for public-device exit (GUI redesign §11.2, item J).
 *
 * When a public-PC identity is erased, its private data can first be packaged
 * into a handoff archive, encrypted to a linked personal device's pub, and
 * transferred over P2P. On the personal device the archive is merged per
 * category: contacts and talks/answers merge into the local identity;
 * conversation/thread history imports as a **read-only** archive (those
 * pair-threads belong to the erased identity).
 *
 * This module is pure (no Gun/DOM/crypto) so build + merge are unit-testable.
 */

export const HANDOFF_ARCHIVE_VERSION = 1 as const;

export interface HandoffArchive {
  version: typeof HANDOFF_ARCHIVE_VERSION;
  /** Public key of the erased (source) identity. */
  fromPub: string;
  createdAt: number;
  profile?: Record<string, unknown>;
  /** Known people / contacts, each keyed by a stable `id`. */
  contacts?: Array<Record<string, unknown> & { id: string }>;
  /** Intake filters (includes the editable dirtyWords list). */
  talkFilters?: Record<string, unknown> & { dirtyWords?: string[] };
  /** Answer preferences keyed by question/identity key. */
  answerPreferences?: Record<string, unknown>;
  /** Owned/known talks keyed by talk id. */
  myTalks?: Record<string, unknown>;
  /** Conversation/thread history — imported read-only. */
  conversations?: Record<string, unknown>;
}

export interface HandoffSources {
  fromPub: string;
  now?: number;
  profile?: Record<string, unknown>;
  contacts?: Array<Record<string, unknown> & { id: string }>;
  talkFilters?: Record<string, unknown> & { dirtyWords?: string[] };
  answerPreferences?: Record<string, unknown>;
  myTalks?: Record<string, unknown>;
  conversations?: Record<string, unknown>;
}

/** The category progress a Sync-progress dialog reports (§11.2). */
export const HANDOFF_CATEGORIES = [
  'profile',
  'contacts',
  'talkFilters',
  'answerPreferences',
  'myTalks',
  'conversations',
] as const;
export type HandoffCategory = (typeof HANDOFF_CATEGORIES)[number];

/** Package the source device's private data into a handoff archive. */
export function buildHandoffArchive(sources: HandoffSources): HandoffArchive {
  const archive: HandoffArchive = {
    version: HANDOFF_ARCHIVE_VERSION,
    fromPub: sources.fromPub,
    createdAt: sources.now ?? Date.now(),
  };
  if (sources.profile) archive.profile = sources.profile;
  if (sources.contacts) archive.contacts = sources.contacts;
  if (sources.talkFilters) archive.talkFilters = sources.talkFilters;
  if (sources.answerPreferences) archive.answerPreferences = sources.answerPreferences;
  if (sources.myTalks) archive.myTalks = sources.myTalks;
  if (sources.conversations) archive.conversations = sources.conversations;
  return archive;
}

export interface LocalMergeTarget {
  contacts?: Array<Record<string, unknown> & { id: string }>;
  talkFilters?: (Record<string, unknown> & { dirtyWords?: string[] }) | undefined;
  answerPreferences?: Record<string, unknown>;
  myTalks?: Record<string, unknown>;
}

export interface HandoffMergeResult {
  contacts: Array<Record<string, unknown> & { id: string }>;
  talkFilters: (Record<string, unknown> & { dirtyWords?: string[] }) | undefined;
  answerPreferences: Record<string, unknown>;
  myTalks: Record<string, unknown>;
  /** Imported read-only conversation archive (never merged into the live store). */
  readOnlyConversations: Record<string, unknown>;
}

/**
 * Merge a handoff archive into the local identity (§11.2):
 *  - contacts: union by id (local wins on conflict — local is the surviving identity)
 *  - myTalks / answerPreferences: shallow union by key (local wins)
 *  - talkFilters: keep local; union the dirtyWords lists
 *  - conversations: returned separately as a read-only archive, never merged live
 */
export function mergeHandoffArchive(archive: HandoffArchive, local: LocalMergeTarget = {}): HandoffMergeResult {
  const localContacts = local.contacts ?? [];
  const byId = new Map<string, Record<string, unknown> & { id: string }>();
  for (const c of archive.contacts ?? []) if (c && c.id) byId.set(c.id, c);
  for (const c of localContacts) if (c && c.id) byId.set(c.id, c); // local wins

  const talkFilters = mergeTalkFilters(archive.talkFilters, local.talkFilters);

  return {
    contacts: Array.from(byId.values()),
    talkFilters,
    answerPreferences: { ...(archive.answerPreferences ?? {}), ...(local.answerPreferences ?? {}) },
    myTalks: { ...(archive.myTalks ?? {}), ...(local.myTalks ?? {}) },
    readOnlyConversations: archive.conversations ?? {},
  };
}

function mergeTalkFilters(
  incoming: (Record<string, unknown> & { dirtyWords?: string[] }) | undefined,
  local: (Record<string, unknown> & { dirtyWords?: string[] }) | undefined,
): (Record<string, unknown> & { dirtyWords?: string[] }) | undefined {
  if (!incoming && !local) return undefined;
  const base = { ...(incoming ?? {}), ...(local ?? {}) }; // local wins on scalar fields
  const dirty = new Set<string>([...(incoming?.dirtyWords ?? []), ...(local?.dirtyWords ?? [])]);
  if (incoming?.dirtyWords || local?.dirtyWords) base.dirtyWords = Array.from(dirty);
  return base;
}
