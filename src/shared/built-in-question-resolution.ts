/**
 * §BB / spec §30.2: resolves a `builtIn` question's outcome from typed values — the dispatch
 * counterpart to `findAutoAnswer`/`findAutoAnswerMultiple` (exact-chatbot-memory.ts) for
 * ordinary text-choice questions. Never guesses: returns `ASK_USER` (send to the human inbox,
 * same as today's missing-history behavior) whenever the responder has no matching stored
 * preference, the built-in kind isn't wired for auto-resolution yet, or the comparison inputs
 * are otherwise incomplete. A computed incompatibility is a confident `ANSWER` with
 * `compatible: false` — exact math, not a heuristic, per the "computed 'not compatible' is
 * trustworthy enough to auto-resolve" decision in `docs/TODO.md` §BB.
 */
import type { Talk, Question } from './types';
import { intervalsOverlap, quantitySufficient } from './built-in-comparisons';
import { getTypedPreference, makeTypedPreferenceScopeKey, type TypedPreferenceState } from './typed-preference-store';

export type BuiltInResolution = { action: 'ANSWER'; compatible: boolean } | { action: 'ASK_USER' };

/**
 * `talk.role` is used as an interim typed-preference scope substitute for the real
 * opposite-tag (Phase 1's `tag-opposite-pairs.ts` registry) until Phase 5 wires a tag picker
 * into the talk editor and a talk actually carries a resolvable deal tag — today `role` is the
 * only live, wired categorical dimension a talk carries. Revisit once Phase 5 ships.
 *
 * `location` is deferred entirely (always `ASK_USER`): it needs a geo/privacy-aware source for
 * "my own" location + radius (the responder's blurred coordinate, or a matching counterpart
 * talk's own `authorLocation`/`locationRadiusMiles`) that hasn't been designed yet — see
 * `locationsMutuallyContained` in `built-in-comparisons.ts`, which is ready to be called once
 * that source exists.
 */
export function resolveBuiltInQuestion(
  talk: Pick<Talk, 'role' | 'title'>,
  question: Pick<Question, 'builtIn'>,
  preferenceState: TypedPreferenceState,
  userId: string,
): BuiltInResolution {
  const builtIn = question.builtIn;
  if (!builtIn) return { action: 'ASK_USER' };
  if (builtIn.kind === 'location') return { action: 'ASK_USER' };

  const scopeKey = makeTypedPreferenceScopeKey(String(talk.role || 'general'), talk.title);
  const myPref = getTypedPreference(preferenceState, userId, scopeKey);
  if (!myPref || myPref.kind !== builtIn.kind) return { action: 'ASK_USER' };

  if (builtIn.kind === 'quantity') {
    if (typeof builtIn.quantity !== 'number' || typeof myPref.quantity !== 'number' || !talk.role) {
      return { action: 'ASK_USER' };
    }
    // Spec §30.2: buyer's want N, seller's declared available M -> compatible iff N <= M.
    // The incoming talk's role tells us which side ITS declared quantity represents: role
    // 'offer' means it declared what it HAS (M), so my own stored quantity is what I WANT (N);
    // role 'request' means it declared what it WANTS (N), so mine is what I HAVE (M).
    const want = talk.role === 'offer' ? myPref.quantity : builtIn.quantity;
    const have = talk.role === 'offer' ? builtIn.quantity : myPref.quantity;
    return { action: 'ANSWER', compatible: quantitySufficient(want, have) };
  }

  if (builtIn.kind === 'priceRange') {
    if (!builtIn.priceRange || !myPref.priceRange) return { action: 'ASK_USER' };
    return { action: 'ANSWER', compatible: intervalsOverlap(builtIn.priceRange, myPref.priceRange) };
  }

  if (builtIn.kind === 'timeFrame') {
    if (!builtIn.timeFrame || !myPref.timeFrame) return { action: 'ASK_USER' };
    return {
      action: 'ANSWER',
      compatible: intervalsOverlap(
        { min: builtIn.timeFrame.start, max: builtIn.timeFrame.end },
        { min: myPref.timeFrame.start, max: myPref.timeFrame.end },
      ),
    };
  }

  return { action: 'ASK_USER' };
}
