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
import { getOppositeTagName, createSeededTagOppositePairRegistryState } from './tag-opposite-pairs';
import { intervalsOverlap, quantitySufficient } from './built-in-comparisons';
import { getTypedPreference, makeTypedPreferenceScopeKey, type TypedPreferenceState } from './typed-preference-store';

export type BuiltInResolution = { action: 'ANSWER'; compatible: boolean } | { action: 'ASK_USER' };

/**
 * Spec §30.2 Phase 5: `talk.selfTag`'s opposite (via the `tag-opposite-pairs.ts` seed
 * registry — buy/sell, hiring/jobseeking) stands in for "my own" side of the deal, the same
 * role `complementRole(talk.role)` used to play before role was generalized into free-form
 * self-tag/preference-set pairs. Only resolves for the app-predefined singleton pairs today;
 * a talk whose selfTag has no seeded opposite (or a genuinely multi-value preferenceSet) falls
 * through to `ASK_USER` below, same fail-safe posture as every other unresolvable case.
 *
 * `location` is deferred entirely (always `ASK_USER`): it needs a geo/privacy-aware source for
 * "my own" location + radius (the responder's blurred coordinate, or a matching counterpart
 * talk's own `authorLocation`/`locationRadiusMiles`) that hasn't been designed yet — see
 * `locationsMutuallyContained` in `built-in-comparisons.ts`, which is ready to be called once
 * that source exists.
 */
export function resolveBuiltInQuestion(
  talk: Pick<Talk, 'selfTag' | 'title'>,
  question: Pick<Question, 'builtIn'> & { text?: string },
  preferenceState: TypedPreferenceState,
  userId: string,
): BuiltInResolution {
  const builtIn = question.builtIn;
  if (!builtIn) return { action: 'ASK_USER' };
  if (builtIn.kind === 'location') return { action: 'ASK_USER' };

  // Scoped by MY OWN selfTag (the opposite of the incoming talk's selfTag), not the incoming
  // talk's selfTag directly — this must match the scope key `processTalkForm` (ui-manager.ts)
  // saves under when I create MY OWN talk, where the scope is always my own talk's selfTag. A
  // buyer's incoming-talk-side lookup (talk.selfTag='sell', opposite='buy') and a buyer's own
  // saved preference (from authoring their own selfTag='buy' talk) must resolve to the SAME
  // scope key.
  //
  // The question's own text is ALSO part of the scope key — without it, a talk with more than
  // one builtIn question (e.g. priceRange AND timeFrame in the same talk, §HH) would have both
  // saved under the identical (selfTag, title) key, the second silently overwriting the first.
  const myTag = getOppositeTagName(createSeededTagOppositePairRegistryState(), talk.selfTag || '');
  const scopeKey = makeTypedPreferenceScopeKey(String(myTag || 'general'), talk.title, question.text);
  const myPref = getTypedPreference(preferenceState, userId, scopeKey);
  if (!myPref || myPref.kind !== builtIn.kind) return { action: 'ASK_USER' };

  if (builtIn.kind === 'quantity') {
    if (typeof builtIn.quantity !== 'number' || typeof myPref.quantity !== 'number' || !talk.selfTag) {
      return { action: 'ASK_USER' };
    }
    // Spec §30.2: buyer's want N, seller's declared available M -> compatible iff N <= M.
    // The incoming talk's selfTag tells us which side ITS declared quantity represents:
    // selfTag 'sell' means it declared what it HAS (M), so my own stored quantity is what I
    // WANT (N); selfTag 'buy' means it declared what it WANTS (N), so mine is what I HAVE (M).
    // Case-insensitive since selfTag is free text, not a fixed enum like role was; only the
    // app-predefined 'sell' spelling resolves a direction today (same seeded-pairs-only scope
    // as the rest of this function).
    const isSell = talk.selfTag?.trim().toLowerCase() === 'sell';
    const want = isSell ? myPref.quantity : builtIn.quantity;
    const have = isSell ? builtIn.quantity : myPref.quantity;
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

/**
 * Picks which of a `builtIn` question's 2 synthetic answers (`TalkAutofix.fix`) a resolution
 * selects — by their fixed, deterministic ids (`${questionId}_compatible` /
 * `${questionId}_incompatible`, set once at generation time and never changed), NOT by
 * `isMatch`/`isIgnore` flags.
 *
 * This distinction is load-bearing: when a builtIn question links to a NEXT question (i.e. it
 * isn't the last one in the chain), the flow-normalization step in `TalkAutofix.fix` strips
 * `isMatch` from the "compatible" answer and replaces it with `nextQuestionId` — the same
 * redirect every ordinary flow question's first answer goes through. An `isMatch`-based lookup
 * therefore only ever finds the compatible answer when the builtIn question happens to be
 * terminal (the last in the chain) — a real bug found via docs/TODO.md §HH's 3-criterion
 * handyman talk (priceRange -> timeFrame -> service category), where the first two questions
 * are never terminal. `86-builtin-quantity-match.spec.ts`'s single-question talks never
 * exercised the non-terminal case.
 */
export function pickBuiltInAnswer<T extends { id: string }>(
  answers: T[] | undefined,
  questionId: string,
  resolution: BuiltInResolution,
): T | undefined {
  if (resolution.action !== 'ANSWER') return undefined;
  const targetId = `${questionId}_${resolution.compatible ? 'compatible' : 'incompatible'}`;
  return (answers || []).find((a) => a?.id === targetId);
}
