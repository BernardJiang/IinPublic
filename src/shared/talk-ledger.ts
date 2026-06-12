/**
 * src/shared/talk-ledger.ts
 *
 * Unified local talk-outcome ledger — step 8 of P0.
 *
 * Design ref: docs/design/p0-steps8-11-ledger.md
 *
 * Pure module: no DOM, no Gun, no localStorage.  All state lives in a
 * TalkLedgerDoc value that the caller stores however it likes.
 *
 * Steps 9–11 will add callers; the types + pure fns they need are present now
 * so stored docs need no migration later (the "no-migration guarantee").
 */

// ─── Constants (client mirrors of server defaults) ───────────────────────────

/** Mirror of server CONFIG.SYMMETRIC_TALK_EDGE_COOLDOWN_MS default (0 = off in prod). */
export const TALK_EDGE_COOLDOWN_MS = 0;

/** Mirror of server CONFIG.RATE_LIMITS.TALK_SEND_DAILY = 10. */
export const TALK_SEND_DAILY = 10;

/** Mirror of server CONFIG.RATE_LIMITS.TALK_SEND_WEEKLY = 50. */
export const TALK_SEND_WEEKLY = 50;

/**
 * When true the edge quota check always passes (unlimited).
 * Set by the web app bootstrap when E2E_GUN_MEMORY_ONLY is detected so
 * high-fanout E2E specs (find-similar 9/9) are not throttled.
 */
export let talkLedgerQuotaUnlimited = false;

export function setTalkLedgerQuotaUnlimited(v: boolean): void {
  talkLedgerQuotaUnlimited = v;
}

// ─── Size bounds ──────────────────────────────────────────────────────────────

const OUTCOMES_CAP = 5_000;
const EXCHANGED_CAP = 5_000;
const RETRACTED_CAP = 20_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Outcome = 'matched' | 'ignored' | 'no-reply';

/**
 * (A) Author outcome — "who answered MY talk and how".
 * Key: `${responderId}::${talkId}::${authorId}`
 */
export type OutcomeEntry = {
  responderId: string;
  talkId: string;
  authorId: string;
  /** Links outcome → exchanged/suppression (step 11). */
  identityKey: string;
  outcome: Outcome;
  /** Responder's response version (REQ-LEDGER-04). */
  version: number;
  /** CIDv1 of the winning response. */
  responseId: string;
  /** ISO — last-writer tiebreak after version. */
  respondedAt: string;
  /** Local ingest time (ISO). */
  updatedAt: string;
};

/**
 * (B) Exchanged set — step 11; symmetric pair-identity record, both roles.
 * Key: `${peerId}::${identityKey}`
 */
export type ExchangedEntry = {
  peerId: string;
  identityKey: string;
  /** The concrete content id this peer used for the shared identity. */
  talkId?: string;
  peerName?: string;
  peerEpub?: string;
  outcome: Outcome;
  version: number;
  /** Who sent the identity; both sides still write an entry. */
  role: 'author' | 'responder';
  lastExchangedAt: string;
};

/**
 * (C) Edge counters — step 8.3 cooldown/quota; key: `${peerId}` (outbound only).
 */
export type EdgeCounter = {
  /** ms epoch — cooldown basis. */
  lastSendAt: number;
  dayBucketStartMs: number;
  sentToday: number;
  weekBucketStartMs: number;
  sentThisWeek: number;
};

/** (D) Retraction tombstone — step 10; key: `${talkId}::${authorId}`. */
export type RetractedEntry = {
  retractedAt: number;
};

/** The single localStorage doc. */
export type TalkLedgerDoc = {
  version: 1;
  /** (A) Author outcomes. Key: `${responderId}::${talkId}::${authorId}` */
  outcomes: Record<string, OutcomeEntry>;
  /** (B) Exchanged set. Key: `${peerId}::${identityKey}` */
  exchanged: Record<string, ExchangedEntry>;
  /** (C) Edge counters. Key: `${peerId}` */
  edges: Record<string, EdgeCounter>;
  /** (D) Retraction tombstones. Key: `${talkId}::${authorId}` */
  retracted: Record<string, RetractedEntry>;
};

/** Event shape passed to applyEvent. */
export type TalkAnsweredEvent = {
  kind: 'TALK_ANSWERED';
  responderId: string;
  talkId: string;
  authorId: string;
  identityKey: string;
  outcome: Outcome;
  version: number;
  responseId: string;
  respondedAt: string;
  /** Local ingest time. */
  now: string;
};

export type TalkRetractedEvent = {
  kind: 'TALK_RETRACTED';
  talkId: string;
  authorId: string;
  retractedAt: number;
};

export type LedgerEvent = TalkAnsweredEvent | TalkRetractedEvent;

// ─── Key builders ──────────────────────────────────────────────────────────────

export function outcomeKey(responderId: string, talkId: string, authorId: string): string {
  return `${responderId}::${talkId}::${authorId}`;
}

export function exchangedKey(peerId: string, identityKey: string): string {
  return `${peerId}::${identityKey}`;
}

export function retractedKey(talkId: string, authorId: string): string {
  return `${talkId}::${authorId}`;
}

// ─── Empty doc factory ────────────────────────────────────────────────────────

export function emptyTalkLedgerDoc(): TalkLedgerDoc {
  return { version: 1, outcomes: {}, exchanged: {}, edges: {}, retracted: {} };
}

// ─── UTC bucket helpers (ported verbatim from server) ─────────────────────────

export function getUtcDayStartMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Monday-start week bucket (UTC).
 *   Monday → same day start; Sunday → previous Monday.
 */
export function getUtcWeekStartMs(nowMs: number): number {
  const dayStartMs = getUtcDayStartMs(nowMs);
  const d = new Date(nowMs);
  const utcDay = d.getUTCDay(); // 0=Sunday … 6=Saturday
  const daysFromMonday = (utcDay + 6) % 7; // Monday→0 … Sunday→6
  return dayStartMs - daysFromMonday * 24 * 60 * 60 * 1000;
}

// ─── compareResponse: version-then-timestamp ordering ────────────────────────

/**
 * Compare two TALK_ANSWERED events (or an event vs an existing OutcomeEntry).
 *
 * Returns:
 *   > 0 — `incoming` is newer (should replace `existing`)
 *   = 0 — equal / exact replay (keep existing)
 *   < 0 — `incoming` is stale (reject)
 *
 * Rule: higher version wins; tie → later respondedAt wins; tie → keep existing.
 */
export function compareResponse(
  existing: { version: number; respondedAt: string; responseId: string },
  incoming: { version: number; respondedAt: string; responseId: string },
): number {
  if (incoming.version !== existing.version) {
    return incoming.version - existing.version;
  }
  // Exact same responseId → idempotent replay
  if (incoming.responseId === existing.responseId) return 0;
  // Same version, different content → compare timestamps
  const tExisting = new Date(existing.respondedAt).getTime();
  const tIncoming = new Date(incoming.respondedAt).getTime();
  return tIncoming - tExisting;
}

// ─── isStaleAgainstRetraction ─────────────────────────────────────────────────

/**
 * Returns true if `answer` should be discarded because the talk has already
 * been retracted (step 10 / REQ-LEDGER-15).
 *
 * An in-flight TALK_ANSWERED whose `respondedAt` predates the retraction
 * is always discarded (retraction wins regardless of version).
 */
export function isStaleAgainstRetraction(
  answer: { respondedAt: string },
  retraction: { retractedAt: number },
): boolean {
  const answerMs = new Date(answer.respondedAt).getTime();
  return answerMs < retraction.retractedAt;
}

// ─── shouldSuppress ────────────────────────────────────────────────────────────

/**
 * Returns true when the sender should skip recipient `peerId` for a talk with
 * the given `identityKey` (REQ-LEDGER-16 / step 8.2).
 *
 * Suppresses if:
 *   (a) An exchanged entry exists for (peerId, identityKey), OR
 *   (b) An outcome row exists for any (responderId=peerId, *, identityKey).
 *
 * Per-identity, not per-talkId-blob — this is the step-11-aligned predicate.
 * Step 11 will add only the per-tag fan-out caller; the predicate itself is
 * shipped here.
 */
export function shouldSuppress(
  doc: TalkLedgerDoc,
  peerId: string,
  identityKey: string,
): boolean {
  // (a) Check exchanged set (fast path for both sides)
  const eKey = exchangedKey(peerId, identityKey);
  if (doc.exchanged[eKey]) return true;

  // (b) Check outcome rows where responderId === peerId AND identityKey matches
  for (const entry of Object.values(doc.outcomes)) {
    if (entry.responderId === peerId && entry.identityKey === identityKey) return true;
  }

  return false;
}

// ─── applyEdgeGate ────────────────────────────────────────────────────────────

/**
 * Check edge-gate conditions for sending to `peerId` at time `nowMs`.
 * If all checks pass, debit the counters in-place and return `{ ok: true }`.
 * If any check fails, return `{ ok: false, rejectedBy: [...reasons] }` without
 * modifying the doc.
 *
 * Constants mirror server defaults (TALK_EDGE_COOLDOWN_MS, TALK_SEND_DAILY,
 * TALK_SEND_WEEKLY). When `talkLedgerQuotaUnlimited` is true all quota checks
 * are skipped (E2E parity with server E2E_GUN_MEMORY_ONLY=1 unlimited mode).
 */
export function applyEdgeGate(
  doc: TalkLedgerDoc,
  peerId: string,
  nowMs: number,
): { ok: boolean; rejectedBy: string[] } {
  if (talkLedgerQuotaUnlimited) {
    touchEdge(doc, peerId, nowMs);
    return { ok: true, rejectedBy: [] };
  }

  const rejectedBy: string[] = [];
  const edge = doc.edges[peerId];

  // Cooldown check
  if (TALK_EDGE_COOLDOWN_MS > 0 && edge) {
    const elapsed = nowMs - edge.lastSendAt;
    if (elapsed < TALK_EDGE_COOLDOWN_MS) {
      rejectedBy.push('edge_cooldown');
    }
  }

  const dayStartMs = getUtcDayStartMs(nowMs);
  const weekStartMs = getUtcWeekStartMs(nowMs);

  // Daily quota check
  if (TALK_SEND_DAILY > 0 && edge) {
    const sentToday = edge.dayBucketStartMs === dayStartMs ? edge.sentToday : 0;
    if (sentToday >= TALK_SEND_DAILY) {
      rejectedBy.push('daily_talk_send_rate_limit');
    }
  }

  // Weekly quota check
  if (TALK_SEND_WEEKLY > 0 && edge) {
    const sentThisWeek = edge.weekBucketStartMs === weekStartMs ? edge.sentThisWeek : 0;
    if (sentThisWeek >= TALK_SEND_WEEKLY) {
      rejectedBy.push('weekly_talk_send_rate_limit');
    }
  }

  if (rejectedBy.length > 0) {
    return { ok: false, rejectedBy };
  }

  touchEdge(doc, peerId, nowMs);
  return { ok: true, rejectedBy: [] };
}

/** Debit edge counters in-place after a successful gate check. */
function touchEdge(doc: TalkLedgerDoc, peerId: string, nowMs: number): void {
  const dayStartMs = getUtcDayStartMs(nowMs);
  const weekStartMs = getUtcWeekStartMs(nowMs);

  const existing = doc.edges[peerId];
  if (!existing) {
    doc.edges[peerId] = {
      lastSendAt: nowMs,
      dayBucketStartMs: dayStartMs,
      sentToday: 1,
      weekBucketStartMs: weekStartMs,
      sentThisWeek: 1,
    };
    return;
  }

  existing.lastSendAt = nowMs;

  if (existing.dayBucketStartMs !== dayStartMs) {
    existing.dayBucketStartMs = dayStartMs;
    existing.sentToday = 0;
  }
  if (existing.weekBucketStartMs !== weekStartMs) {
    existing.weekBucketStartMs = weekStartMs;
    existing.sentThisWeek = 0;
  }
  if (TALK_SEND_DAILY > 0) existing.sentToday += 1;
  if (TALK_SEND_WEEKLY > 0) existing.sentThisWeek += 1;
}

// ─── applyEvent ───────────────────────────────────────────────────────────────

/**
 * Apply a ledger event to the doc in-place, following the global ordering
 * invariant: version-then-timestamp, retraction beats both.
 *
 * For TALK_ANSWERED:
 *   - Reject if the talk has been retracted (isStaleAgainstRetraction).
 *   - Reject if there's an existing entry and compareResponse ≤ 0 (stale/replay).
 *   - Otherwise write/replace (A) outcome and co-write (B) exchanged.
 *
 * For TALK_RETRACTED:
 *   - Always accept; write (D) tombstone; clear (A)+(B) for talkId::authorId.
 *
 * Returns the (possibly mutated) doc for chaining.
 */
export function applyEvent(doc: TalkLedgerDoc, event: LedgerEvent): TalkLedgerDoc {
  if (event.kind === 'TALK_RETRACTED') {
    const rKey = retractedKey(event.talkId, event.authorId);
    const existing = doc.retracted[rKey];
    doc.retracted[rKey] = {
      retractedAt: existing ? Math.max(existing.retractedAt, event.retractedAt) : event.retractedAt,
    };
    // Clear all outcome rows for this talkId+authorId
    for (const [k, entry] of Object.entries(doc.outcomes)) {
      if (entry.talkId === event.talkId && entry.authorId === event.authorId) {
        delete doc.outcomes[k];
        // Also clear the corresponding exchanged entry
        const eKey = exchangedKey(entry.responderId, entry.identityKey);
        delete doc.exchanged[eKey];
      }
    }
    evictLedger(doc);
    return doc;
  }

  // TALK_ANSWERED
  const rKey = retractedKey(event.talkId, event.authorId);
  const tombstone = doc.retracted[rKey];
  if (tombstone && isStaleAgainstRetraction(event, tombstone)) {
    return doc; // retraction wins
  }

  const oKey = outcomeKey(event.responderId, event.talkId, event.authorId);
  const existingOutcome = doc.outcomes[oKey];
  if (existingOutcome) {
    const cmp = compareResponse(existingOutcome, event);
    if (cmp <= 0) return doc; // stale or exact replay
  }

  const outcomeEntry: OutcomeEntry = {
    responderId: event.responderId,
    talkId: event.talkId,
    authorId: event.authorId,
    identityKey: event.identityKey,
    outcome: event.outcome,
    version: event.version,
    responseId: event.responseId,
    respondedAt: event.respondedAt,
    updatedAt: event.now,
  };
  doc.outcomes[oKey] = outcomeEntry;

  // Co-write (B) exchanged — author side writes with role:'author'
  const eKey = exchangedKey(event.responderId, event.identityKey);
  const existingExchanged = doc.exchanged[eKey];
  if (!existingExchanged || event.version > existingExchanged.version) {
    doc.exchanged[eKey] = {
      peerId: event.responderId,
      identityKey: event.identityKey,
      outcome: event.outcome,
      version: event.version,
      role: 'author',
      lastExchangedAt: event.respondedAt,
    };
  }

  evictLedger(doc);
  return doc;
}

// ─── evictLedger (LRU by date) ─────────────────────────────────────────────────

/**
 * Trim outcomes/exchanged/retracted to their caps by evicting oldest entries.
 * edges is bounded by distinct peers (≈ roster size) and not capped here.
 *
 * Losing an entry costs one redundant send — never a correctness bug.
 */
export function evictLedger(doc: TalkLedgerDoc): void {
  evictSection(doc.outcomes, OUTCOMES_CAP, (e) => e.updatedAt);
  evictSection(doc.exchanged, EXCHANGED_CAP, (e) => e.lastExchangedAt);
  evictSection(doc.retracted, RETRACTED_CAP, (e) => String(e.retractedAt));
}

function evictSection<T>(
  section: Record<string, T>,
  cap: number,
  getDate: (e: T) => string,
): void {
  const keys = Object.keys(section);
  if (keys.length <= cap) return;
  // Sort oldest-first and remove oldest (keys.length - cap) entries
  const sorted = keys.slice().sort((a, b) => {
    const ta = new Date(getDate(section[a]!)).getTime();
    const tb = new Date(getDate(section[b]!)).getTime();
    return ta - tb;
  });
  const toRemove = keys.length - cap;
  for (let i = 0; i < toRemove; i++) {
    delete section[sorted[i]!];
  }
}

// ─── buildTagIdentityKeys ──────────────────────────────────────────────────────

/**
 * Step 11.1 — per-identity keys for a talk.
 *
 * For a **tag** talk: returns one identityKey per tag (hash of the single tag's
 * normalized text — each tag is an independent atom per REQ-LEDGER-16).
 *
 * For flow/route/survey: returns the single whole-talk identityKey passed in
 * (these have no independent atoms; the caller computes it from buildTalkIdentityKey).
 *
 * This is a synchronous function using the same FNV-1a hash as buildTalkIdentityKey
 * (no crypto.subtle needed) to keep it usable at recipient-selection time.
 *
 * Exposed here so step 11 adds only the per-tag fan-out caller with no rework.
 */
export function buildTagIdentityKeys(
  talkData: { type?: string; questions?: Array<{ answers?: Array<{ text?: string }> }> },
  wholeTalkIdentityKey: string,
): string[] {
  if (!talkData || talkData.type !== 'tag') {
    return [wholeTalkIdentityKey];
  }

  // For tag talks: each answer option is a tag
  const answers = talkData.questions?.[0]?.answers;
  if (!Array.isArray(answers) || answers.length === 0) {
    return [wholeTalkIdentityKey];
  }

  return answers.map((a) => {
    const normalized = String(a?.text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    return `qa_tag_${fnv1a32(normalized)}`;
  });
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ─── filterTalkForRecipient ────────────────────────────────────────────────────

/**
 * Step 11.3 — per-recipient tag filtering.
 *
 * For a **tag** talk, returns a shallow copy of the talk with the
 * `questions[0].answers` array reduced to only the answers whose identity key
 * is NOT in `suppressedIdentityKeys`.
 *
 * For flow/route/survey talks (no independent atoms), returns null — the caller
 * should skip the recipient entirely if the whole-talk identity is suppressed,
 * or deliver the unmodified talk if not.
 *
 * Returns null also when:
 *   - The talk has no questions/answers (guard).
 *   - ALL answers are suppressed (caller should skip this recipient entirely).
 *   - NO answers are suppressed (no filtering needed; caller uses the original).
 *
 * The return shape mirrors the input type so the caller can pass it directly to
 * broadcastTalk.  The `wholeTalkIdentityKey` parameter is unused for tag talks
 * (we compute per-answer keys) but is accepted so the call site is uniform.
 *
 * @returns  null when no filtering is needed or when the recipient should be
 *           skipped entirely.
 *           A filtered copy of the talk (with suppressed answers removed) when
 *           partial filtering applies.
 */
export function filterTalkForRecipient(
  talkData: { type?: string; questions?: Array<{ answers?: Array<{ text?: string }> }> },
  suppressedIdentityKeys: Set<string>,
): { filtered: Record<string, unknown> } | null {
  if (!talkData || talkData.type !== 'tag') return null;

  const answers = talkData.questions?.[0]?.answers;
  if (!Array.isArray(answers) || answers.length === 0) return null;

  const remaining = answers.filter((a) => {
    const normalized = String(a?.text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
    const key = `qa_tag_${fnv1a32(normalized)}`;
    return !suppressedIdentityKeys.has(key);
  });

  // All answers suppressed — caller should skip recipient entirely.
  if (remaining.length === 0) return null;
  // No answers suppressed — no filtering needed.
  if (remaining.length === answers.length) return null;

  // Partial suppression: return a filtered shallow copy.
  const talkRecord = talkData as Record<string, unknown>;
  const questions = Array.isArray(talkRecord['questions']) ? (talkRecord['questions'] as unknown[]) : [];
  const q0 = questions[0] as Record<string, unknown> | undefined;
  const filteredQuestions = [{ ...q0, answers: remaining }, ...questions.slice(1)];
  return {
    filtered: { ...talkRecord, questions: filteredQuestions },
  };
}
