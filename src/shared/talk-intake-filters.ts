import type { GPSCoordinate, TalkIntakeFilters } from './types';
import { ContentFilter } from './reputation';

export type IncomingTalkFilterSubject = {
  title?: string;
  type?: string;
  language?: string;
  updatedAt?: string;
  createdAt?: string;
  /** Unix-ms timestamp after which the talk is considered expired and must not be delivered. */
  expiresAt?: number | string | null;
  authorLocation?: { latitude: number; longitude: number };
  questionsJson?: string;
  questions?: Array<{ text?: string; answers?: Array<{ text?: string }> }>;
  isAdult?: boolean;
};

/**
 * Receiver-context supplied by the caller after any async resolution (e.g. fetching ageVerified
 * from the server). Kept separate from TalkIntakeFilters so the synchronous shared function does
 * not need async I/O.
 */
export type ReceiverIntakeContext = {
  /** Whether the receiver has passed age verification (AGE_VERIFICATION_THRESHOLD). */
  ageVerified?: boolean;
};

const MAX_CUSTOM_BLOCKED_TERMS = 50;
const MAX_CUSTOM_TERM_LEN = 48;

/** Default dirty-word list seeded into every user's editable filter (redesign §9.1). */
export const DEFAULT_DIRTY_WORDS: readonly string[] = ['fuck', 'cunt', 'bitch', 'cock'];

/** Normalize per-user custom blocked phrases from JSON or UI (lowercase, deduped, capped). */
export function normalizeCustomBlockedTerms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CUSTOM_BLOCKED_TERMS) break;
    const t = String(item ?? '')
      .trim()
      .toLowerCase()
      .slice(0, MAX_CUSTOM_TERM_LEN);
    if (t.length < 2) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Normalize a dirty-word list from UI/persistence. Same rules as custom blocked
 * terms (2–48 chars, lowercase, deduped, cap 50). Returned list is safe to feed
 * to ContentFilter as the merged custom word set.
 */
export function normalizeDirtyWords(raw: unknown): string[] {
  return normalizeCustomBlockedTerms(raw);
}

export function getDefaultTalkIntakeFilters(seedLanguages?: string[]): TalkIntakeFilters {
  return {
    allowedLanguages: Array.isArray(seedLanguages) && seedLanguages.length > 0 ? seedLanguages : ['en'],
    minDistanceMiles: 0,
    maxDistanceMiles: 50,
    requireGoodGrammar: true,
    blockDirtyWords: true,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
    customBlockedTerms: [],
    dirtyWords: [...DEFAULT_DIRTY_WORDS],
  };
}

function parseQuestionsText(subject: IncomingTalkFilterSubject): string[] {
  if (Array.isArray(subject.questions) && subject.questions.length > 0) {
    return subject.questions.flatMap((question) => {
      const parts = [String(question?.text || '').trim()];
      for (const answer of Array.isArray(question?.answers) ? question.answers : []) {
        const text = String(answer?.text || '').trim();
        if (text) parts.push(text);
      }
      return parts.filter(Boolean);
    });
  }

  if (!subject.questionsJson) return [];
  try {
    const parsed = JSON.parse(subject.questionsJson) as Array<{ text?: string; answers?: Array<{ text?: string }> }>;
    return parsed.flatMap((question) => {
      const parts = [String(question?.text || '').trim()];
      for (const answer of Array.isArray(question?.answers) ? question.answers : []) {
        const text = String(answer?.text || '').trim();
        if (text) parts.push(text);
      }
      return parts.filter(Boolean);
    });
  } catch {
    return [];
  }
}

function buildSubjectText(subject: IncomingTalkFilterSubject): string {
  return [subject.title || '', ...parseQuestionsText(subject)].filter(Boolean).join('. ');
}

function parseQuestionPromptText(subject: IncomingTalkFilterSubject): string[] {
  if (Array.isArray(subject.questions) && subject.questions.length > 0) {
    return subject.questions
      .map((question) => String(question?.text || '').trim())
      .filter(Boolean);
  }

  if (!subject.questionsJson) return [];
  try {
    const parsed = JSON.parse(subject.questionsJson) as Array<{ text?: string }>;
    return parsed
      .map((question) => String(question?.text || '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function buildGrammarSubjectText(subject: IncomingTalkFilterSubject): string {
  return [subject.title || '', ...parseQuestionPromptText(subject)].filter(Boolean).join('. ');
}

/** Case-insensitive substring match against talk title + question/answer text. */
export function subjectTextMatchesBlockedTerms(
  subject: IncomingTalkFilterSubject,
  terms: readonly string[],
): boolean {
  if (!terms.length) return false;
  const haystack = buildSubjectText(subject).toLowerCase();
  return terms.some((t) => t.length > 0 && haystack.includes(t.toLowerCase()));
}

/** Miles between two WGS84 points — shared with bulk broadcast targeting. */
export function haversineMilesBetween(
  a: GPSCoordinate | { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Stable codes for `rejectedBy` when talk intake filters fail (server delivery path). */
export function intakeFilterRejectReasons(
  subject: IncomingTalkFilterSubject,
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
  receiverContext?: ReceiverIntakeContext,
): string[] {
  // Expiry check: reject before any other filter so expired bodies are never cached.
  if (subject.expiresAt !== undefined && subject.expiresAt !== null) {
    const expiresAtMs =
      typeof subject.expiresAt === 'number'
        ? subject.expiresAt
        : typeof subject.expiresAt === 'string' && subject.expiresAt.trim()
          ? new Date(subject.expiresAt).getTime()
          : Number.NaN;
    if (Number.isFinite(expiresAtMs) && Date.now() > expiresAtMs) {
      return ['talk_expired'];
    }
  }

  // Adult content gate: reject if talk is adult-flagged and the receiver has not verified age.
  if (subject.isAdult && receiverContext && receiverContext.ageVerified === false) {
    return ['age_gate'];
  }

  const type = String(subject.type || 'flow').toLowerCase() as 'flow' | 'survey' | 'tag' | 'route';
  if (Array.isArray(filters.allowedTalkTypes) && filters.allowedTalkTypes.length > 0) {
    if (!filters.allowedTalkTypes.includes(type)) return ['intake_talk_type'];
  }

  if (filters.sentAfter) {
    const sentAt = new Date(subject.updatedAt || subject.createdAt || 0).getTime();
    const minTime = new Date(filters.sentAfter).getTime();
    if (!Number.isNaN(sentAt) && !Number.isNaN(minTime) && sentAt < minTime) return ['intake_sent_after'];
  }

  if (
    currentLocation &&
    subject.authorLocation &&
    (typeof filters.minDistanceMiles === 'number' || typeof filters.maxDistanceMiles === 'number')
  ) {
    const distance = haversineMilesBetween(currentLocation, subject.authorLocation);
    if (typeof filters.minDistanceMiles === 'number' && distance < filters.minDistanceMiles) {
      return ['intake_min_distance'];
    }
    if (typeof filters.maxDistanceMiles === 'number' && distance > filters.maxDistanceMiles) {
      return ['intake_max_distance'];
    }
  }

  const subjectText = buildSubjectText(subject);
  const grammarSubjectText = buildGrammarSubjectText(subject);
  if (filters.allowedLanguages.length > 0) {
    const knownLanguage = String(subject.language || '').trim().toLowerCase();
    const normalizedAllowedLanguages = filters.allowedLanguages.map((lang) => lang.toLowerCase());
    if (knownLanguage) {
      if (!normalizedAllowedLanguages.includes(knownLanguage)) return ['intake_language'];
    } else if (
      !ContentFilter.applyFilters(
        subjectText,
        {
          language: true,
          grammar: false,
          dirtyWords: false,
          location: { enabled: false, maxDistance: 0 },
          age: { enabled: false, minAge: 0, maxAge: 0 },
        },
        normalizedAllowedLanguages,
      ).passed
    ) {
      return ['intake_language'];
    }
  }

  if (filters.requireGoodGrammar) {
    const result = ContentFilter.applyFilters(
      grammarSubjectText,
      {
        language: false,
        grammar: true,
        dirtyWords: false,
        location: { enabled: false, maxDistance: 0 },
        age: { enabled: false, minAge: 0, maxAge: 0 },
      },
      filters.allowedLanguages,
    );
    if (!result.passed) return ['intake_grammar'];
  }

  if (filters.blockDirtyWords) {
    const result = ContentFilter.applyFilters(
      subjectText,
      {
        language: false,
        grammar: false,
        dirtyWords: true,
        location: { enabled: false, maxDistance: 0 },
        age: { enabled: false, minAge: 0, maxAge: 0 },
      },
      filters.allowedLanguages,
      normalizeDirtyWords(filters.dirtyWords),
    );
    if (!result.passed) return ['intake_dirty_words'];
  }

  const custom = normalizeCustomBlockedTerms(filters.customBlockedTerms);
  if (custom.length > 0 && subjectTextMatchesBlockedTerms(subject, custom)) {
    return ['intake_custom_blocked_terms'];
  }

  return [];
}

export function talkPassesIntakeFilters(
  subject: IncomingTalkFilterSubject,
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
  receiverContext?: ReceiverIntakeContext,
): boolean {
  return intakeFilterRejectReasons(subject, filters, currentLocation, receiverContext).length === 0;
}

export function filterIncomingTalkClusters(
  subjects: IncomingTalkFilterSubject[],
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
  receiverContext?: ReceiverIntakeContext,
): { visible: IncomingTalkFilterSubject[]; hiddenCount: number; hiddenByReason: Record<string, number> } {
  const visible: IncomingTalkFilterSubject[] = [];
  const hiddenByReason: Record<string, number> = {};
  for (const subject of subjects) {
    const reasons = intakeFilterRejectReasons(subject, filters, currentLocation, receiverContext);
    if (reasons.length === 0) {
      visible.push(subject);
      continue;
    }
    for (const reason of reasons) {
      hiddenByReason[reason] = (hiddenByReason[reason] || 0) + 1;
    }
  }
  return {
    visible,
    hiddenCount: Math.max(0, subjects.length - visible.length),
    hiddenByReason,
  };
}
