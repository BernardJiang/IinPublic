/**
 * §BB / spec §30.2: local storage for a user's own typed built-in preference (quantity/price
 * range/time frame — `location` needs no stored preference, it reads `Talk.authorLocation`/
 * `locationRadiusMiles` directly, see `built-in-comparisons.ts`). Deliberately parallel to but
 * structurally separate from `exact-chatbot-memory.ts`: that module only ever stores strings
 * (exact-text answer reuse); this one stores actual typed values so they can be compared with
 * real math (`intervalsOverlap`/`quantitySufficient`) instead of string equality.
 *
 * Scoped by tag, not global — the same user may want $300-500 on a notebook and $10-20 on a
 * book at the same time, so preferences are keyed by `scopeKey` (a tag id, or tag id + item
 * name when the same tag covers multiple distinct items), never by user alone.
 */
import type { BuiltInQuestionKind, BuiltInQuestionSpec } from './types';
import { LOCAL_EXACT_CHATBOT_USER_ID } from './exact-chatbot-memory';

export const LOCAL_TYPED_PREFERENCE_USER_ID = LOCAL_EXACT_CHATBOT_USER_ID;

export interface TypedPreferenceValue {
  kind: BuiltInQuestionKind;
  quantity?: number;
  priceRange?: { min: number; max: number };
  timeFrame?: { start: number; end: number };
  /** kind === 'ageRange' (§DD, spec §30.6). See `Question.builtIn.ageRange` (types.ts). */
  ageRange?: { age: number; acceptableRange: { min: number; max: number } };
  /** The authored talk/question that last populated this lookup index. Optional for
   *  compatibility with values saved before typed declarations became AnswerRecords. */
  sourceTalkId?: string;
  sourceQuestionId?: string;
  updatedAt: number;
}

/** Structured value persisted on an AnswerRecord. Unlike `TypedPreferenceValue`, this is the
 *  durable declaration itself and therefore has no cache timestamp/provenance fields. */
export type TypedAnswerValue = Pick<
  TypedPreferenceValue,
  'kind' | 'quantity' | 'priceRange' | 'timeFrame' | 'ageRange'
>;

/** Copies the typed payload out of a built-in question without retaining mutable references. */
export function typedAnswerValueFromBuiltIn(builtIn: BuiltInQuestionSpec): TypedAnswerValue | undefined {
  if (builtIn.kind === 'location') return undefined;
  return {
    kind: builtIn.kind,
    ...(builtIn.quantity !== undefined ? { quantity: builtIn.quantity } : {}),
    ...(builtIn.priceRange ? { priceRange: { ...builtIn.priceRange } } : {}),
    ...(builtIn.timeFrame ? { timeFrame: { ...builtIn.timeFrame } } : {}),
    ...(builtIn.ageRange
      ? {
          ageRange: {
            age: builtIn.ageRange.age,
            acceptableRange: { ...builtIn.ageRange.acceptableRange },
          },
        }
      : {}),
  };
}

/** Stable human-readable projection used by the Me-tab Q&A row. The structured value above,
 *  not this string, remains authoritative for matching and round trips. */
export function formatTypedAnswerValue(value: TypedAnswerValue): string {
  if (value.kind === 'quantity') return String(value.quantity ?? '');
  if (value.kind === 'priceRange') {
    return value.priceRange ? `${value.priceRange.min} – ${value.priceRange.max}` : '';
  }
  if (value.kind === 'timeFrame') {
    if (!value.timeFrame) return '';
    const date = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);
    return `${date(value.timeFrame.start)} – ${date(value.timeFrame.end)}`;
  }
  if (value.kind === 'ageRange') {
    if (!value.ageRange) return '';
    return `Age ${value.ageRange.age}; accepts ${value.ageRange.acceptableRange.min} – ${value.ageRange.acceptableRange.max}`;
  }
  return '';
}

export interface TypedPreferenceState {
  /** userId -> scopeKey -> value. */
  users: Record<string, Record<string, TypedPreferenceValue>>;
}

export function createEmptyTypedPreferenceState(): TypedPreferenceState {
  return { users: {} };
}

/**
 * `item` (when given) is normalized (trim + lowercase) so "Notebook" and "notebook" share
 * a scope, mirroring how tag/question text is canonicalized elsewhere in this codebase.
 *
 * `questionText` (when given) disambiguates MULTIPLE builtIn questions inside the SAME talk
 * (e.g. a "price range" and a "time frame" question both scoped to the same tag+item) — without
 * it, a talk with two builtIn questions silently collapses to one stored value, since the second
 * save overwrites the first at the same (tagId, item) key. Real bug found while implementing
 * docs/TODO.md §HH (a 3-criterion handyman talk: priceRange + timeFrame + service category).
 */
export function makeTypedPreferenceScopeKey(
  tagId: string,
  item?: string,
  questionText?: string,
  questionContext?: string,
): string {
  const normalizedItem = item ? item.trim().toLowerCase() : '';
  const normalizedQuestionText = questionText ? questionText.trim().toLowerCase() : '';
  const normalizedQuestionContext = questionContext ? questionContext.trim().toLowerCase() : '';
  let key = normalizedItem ? `${tagId}:${normalizedItem}` : tagId;
  if (normalizedQuestionContext) key = `${key}:${normalizedQuestionContext}`;
  if (normalizedQuestionText) key = `${key}:${normalizedQuestionText}`;
  return key;
}

/** Stable route-branch discriminator for two typed questions with the same prompt. Pair-tag
 *  ancestors are omitted because opposite independently-authored talks reverse that pair; its
 *  semantics are already represented by the separate tag part of the scope key. */
export function typedPreferenceQuestionContext(
  talk: { questions?: any[] },
  question: { contextPath?: Array<{ questionId: string; answerId: string }> },
): string {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  return (question.contextPath || [])
    .map((step) => {
      const parent = questions.find((candidate: any) => String(candidate?.id || '') === String(step.questionId || ''));
      if (parent?.reciprocalTagContext) return '';
      const answer = Array.isArray(parent?.answers)
        ? parent.answers.find((candidate: any) => String(candidate?.id || '') === String(step.answerId || ''))
        : undefined;
      return `${String(parent?.text || step.questionId || '').trim()}\u2192${String(answer?.text || step.answerId || '').trim()}`;
    })
    .filter(Boolean)
    .join(' · ');
}

export function saveTypedPreference(
  state: TypedPreferenceState,
  userId: string,
  scopeKey: string,
  value: Omit<TypedPreferenceValue, 'updatedAt'>,
  now = Date.now(),
): void {
  state.users[userId] ??= {};
  state.users[userId][scopeKey] = { ...value, updatedAt: now };
}

export function getTypedPreference(
  state: TypedPreferenceState,
  userId: string,
  scopeKey: string,
): TypedPreferenceValue | undefined {
  return state.users[userId]?.[scopeKey];
}

export function clearTypedPreference(state: TypedPreferenceState, userId: string, scopeKey: string): void {
  delete state.users[userId]?.[scopeKey];
}
