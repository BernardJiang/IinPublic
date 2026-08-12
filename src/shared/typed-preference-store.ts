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
import type { BuiltInQuestionKind } from './types';
import { LOCAL_EXACT_CHATBOT_USER_ID } from './exact-chatbot-memory';

export const LOCAL_TYPED_PREFERENCE_USER_ID = LOCAL_EXACT_CHATBOT_USER_ID;

export interface TypedPreferenceValue {
  kind: BuiltInQuestionKind;
  quantity?: number;
  priceRange?: { min: number; max: number };
  timeFrame?: { start: number; end: number };
  updatedAt: number;
}

export interface TypedPreferenceState {
  /** userId -> scopeKey -> value. */
  users: Record<string, Record<string, TypedPreferenceValue>>;
}

export function createEmptyTypedPreferenceState(): TypedPreferenceState {
  return { users: {} };
}

/** `item` (when given) is normalized (trim + lowercase) so "Notebook" and "notebook" share
 * a scope, mirroring how tag/question text is canonicalized elsewhere in this codebase. */
export function makeTypedPreferenceScopeKey(tagId: string, item?: string): string {
  const normalizedItem = item ? item.trim().toLowerCase() : '';
  return normalizedItem ? `${tagId}:${normalizedItem}` : tagId;
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
