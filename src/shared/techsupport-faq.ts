import { hashIdentityPayload, normalizeIdentityText } from './cid';

/**
 * TechSupport DM Q&A: question normalization + answered-question lookup
 * (docs/TODO.md K5).
 *
 * Behaviour this supports:
 *   - a question TechSupport has answered before is auto-answered locally, from a
 *     cached FAQ bundle, without TechSupport's device being online;
 *   - a new question is queued for a human.
 *
 * **Exact normalized match only.** Fuzzy/semantic matching is deliberately out of
 * scope for v1 — it turns a lookup into an NLP project, and a wrong fuzzy hit
 * answers a user's real question with something unrelated, which is worse than
 * honestly saying "this is new, a human will reply".
 *
 * Normalization builds on `normalizeIdentityText` (trim, collapse whitespace,
 * lowercase) — the same primitive the talk content-id path uses — then strips
 * trailing question/exclamation/period runs so "How do I log in?" and
 * "how do i log in" collapse together. Non-Latin scripts are unaffected by
 * lowercasing and keep their characters intact.
 */

export type SupportFaqEntry = {
  questionKey: string;
  /** The normalized question this entry answers — what the key was derived from. */
  canonicalQuestion: string;
  answer: string;
  answeredAt: string;
};

export type SupportInboxEntry = {
  questionKey: string;
  /** The question as the user actually typed it, for the answering developer to read. */
  question: string;
  askedBy: string;
  conversationId: string;
  askedAt: string;
  status: 'pending' | 'answered';
};

/** Trailing punctuation that carries no meaning for lookup ('?', '!', '.', and CJK forms). */
const TRAILING_PUNCTUATION = /[?？!！.。\s]+$/u;

/**
 * Normalize a support question for lookup. Returns '' for input that carries no
 * question at all, which callers must treat as "not a question" rather than as a
 * key (every empty question would otherwise collide on one FAQ entry).
 */
export function normalizeSupportQuestion(input: unknown): string {
  return normalizeIdentityText(input).replace(TRAILING_PUNCTUATION, '');
}

/**
 * Content-addressed key for a normalized question. Reuses `hashIdentityPayload`
 * (FNV-1a 32-bit) rather than introducing a second hashing scheme.
 *
 * Returns '' for a question that normalizes to empty — callers must check.
 */
export function supportQuestionKey(input: unknown): string {
  const normalized = normalizeSupportQuestion(input);
  if (!normalized) return '';
  return hashIdentityPayload(`support-question:${normalized}`);
}

/** True when the text contains something we can actually look up. */
export function isAnswerableSupportQuestion(input: unknown): boolean {
  return normalizeSupportQuestion(input).length > 0;
}

export type SupportAnswerLookup =
  | { status: 'known'; entry: SupportFaqEntry; questionKey: string }
  | { status: 'new'; questionKey: string }
  | { status: 'unanswerable' };

/**
 * Look a question up in the cached FAQ bundle.
 *
 * - `known`     → auto-answer now, no developer involvement, works offline.
 * - `new`       → acknowledge to the user and queue for a human.
 * - `unanswerable` → the message carried no question text (e.g. an emoji or
 *   whitespace); do not create an inbox entry for it.
 */
export function lookupSupportAnswer(
  question: unknown,
  faq: Iterable<SupportFaqEntry> | ReadonlyMap<string, SupportFaqEntry> | undefined,
): SupportAnswerLookup {
  const questionKey = supportQuestionKey(question);
  if (!questionKey) return { status: 'unanswerable' };

  const entry = faqEntryFor(questionKey, faq);
  if (entry) return { status: 'known', entry, questionKey };
  return { status: 'new', questionKey };
}

function faqEntryFor(
  questionKey: string,
  faq: Iterable<SupportFaqEntry> | ReadonlyMap<string, SupportFaqEntry> | undefined,
): SupportFaqEntry | undefined {
  if (!faq) return undefined;
  if (faq instanceof Map) return faq.get(questionKey);
  for (const entry of faq as Iterable<SupportFaqEntry>) {
    if (entry?.questionKey === questionKey) return entry;
  }
  return undefined;
}

/**
 * Build the FAQ entry a developer's answer promotes into the bundle, so the next
 * asker is auto-answered. Keyed by the *question*, not the asker, so one answer
 * serves everyone.
 */
export function buildSupportFaqEntry(input: {
  question: unknown;
  answer: string;
  answeredAt?: string;
}): SupportFaqEntry | null {
  const canonicalQuestion = normalizeSupportQuestion(input.question);
  const answer = String(input.answer ?? '').trim();
  if (!canonicalQuestion || !answer) return null;
  return {
    questionKey: supportQuestionKey(canonicalQuestion),
    canonicalQuestion,
    answer,
    answeredAt: input.answeredAt || new Date().toISOString(),
  };
}

/**
 * Merge an answered entry into a FAQ bundle, replacing any existing answer for the
 * same question. Returns a new array; the input is not mutated.
 */
export function upsertSupportFaqEntry(
  bundle: readonly SupportFaqEntry[],
  entry: SupportFaqEntry,
): SupportFaqEntry[] {
  const next = bundle.filter((existing) => existing.questionKey !== entry.questionKey);
  next.push(entry);
  return next;
}

/** Deterministic message ids, so a replayed delivery is idempotent (docs/TODO.md K5). */
export function supportAutoAnswerMessageId(userMessageId: string): string {
  return `support_auto_${userMessageId}`;
}

export function supportHumanAnswerMessageId(questionKey: string): string {
  return `support_answer_${questionKey}`;
}
