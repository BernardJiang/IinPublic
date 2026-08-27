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
import type { Question } from './types';
import {
  ageRangeMutuallyAcceptable,
  intervalsOverlap,
  locationsMutuallyContained,
  quantitySufficient,
  type LocationForContainment,
} from './built-in-comparisons';
import { getTypedPreference, makeTypedPreferenceScopeKey, type TypedPreferenceState } from './typed-preference-store';

export type BuiltInResolution = { action: 'ANSWER'; compatible: boolean } | { action: 'ASK_USER' };

/**
 * The tag context for this comparison, derived by the caller from the nearest Pair-tag ancestor
 * (`findTagPairAncestor`/`myEffectiveTagContext`, ui-manager.ts) — the per-question mechanism
 * that replaced the old talk-level `selfTag`/`preferenceSet` root fields. `myTag` is my own
 * declared side (e.g. "buy"); `theirTag` is the incoming talk's own declared side (e.g. "sell"),
 * needed to know which direction a `quantity` comparison's want/have runs. Absent when no
 * qualifying Pair-tag ancestor exists — the same "no context, can't resolve" case as every other
 * missing input below.
 */
export type BuiltInTagContext = {
  myTag?: string | undefined;
  theirTag?: string | undefined;
  title?: string | undefined;
  /**
   * §BB: the responder's OWN most-recent matching talk's `authorLocation`/`locationRadiusMiles`
   * (side "b" of `locationsMutuallyContained`) — see that talk's own doc comment for why this is
   * sourced from a counterpart talk rather than a separately-typed value. Only ever supplied by
   * the caller when the user has granted `locationAutoMatchConsent` (`ui-settings-storage.ts`);
   * this function stays a pure, consent-agnostic resolver, same as every other kind — absence
   * alone (consent withheld, or no qualifying talk found) is what keeps this `ASK_USER`.
   */
  myLocation?: LocationForContainment | undefined;
  /** The incoming talk's own `authorLocation`/`locationRadiusMiles` (side "a") — a talk-level
   *  field, not carried on `Question.builtIn` itself (see `Question.builtIn`'s own doc comment,
   *  types.ts), so the caller threads it through here explicitly. */
  theirLocation?: LocationForContainment | undefined;
};

/**
 * `location` auto-resolves once both sides' location+radius are supplied (§BB) — otherwise
 * `ASK_USER`, same missing-data posture every other kind already has. The caller only ever
 * supplies `myLocation` when the user has explicitly opted in
 * (`getLocationAutoMatchConsent()`) — see `BuiltInTagContext.myLocation`'s own doc comment.
 */
export function resolveBuiltInQuestion(
  tagContext: BuiltInTagContext,
  question: Pick<Question, 'builtIn'> & { text?: string },
  preferenceState: TypedPreferenceState,
  userId: string,
): BuiltInResolution {
  const builtIn = question.builtIn;
  if (!builtIn) return { action: 'ASK_USER' };
  if (builtIn.kind === 'location') {
    if (!tagContext.myLocation || !tagContext.theirLocation) return { action: 'ASK_USER' };
    return {
      action: 'ANSWER',
      compatible: locationsMutuallyContained(tagContext.theirLocation, tagContext.myLocation),
    };
  }

  // The question's own text is ALSO part of the scope key — without it, a talk with more than
  // one builtIn question (e.g. priceRange AND timeFrame in the same talk, §HH) would have both
  // saved under the identical (myTag, title) key, the second silently overwriting the first.
  const scopeKey = makeTypedPreferenceScopeKey(String(tagContext.myTag || 'general'), tagContext.title, question.text);
  const myPref = getTypedPreference(preferenceState, userId, scopeKey);
  if (!myPref || myPref.kind !== builtIn.kind) return { action: 'ASK_USER' };

  if (builtIn.kind === 'quantity') {
    if (typeof builtIn.quantity !== 'number' || typeof myPref.quantity !== 'number' || !tagContext.theirTag) {
      return { action: 'ASK_USER' };
    }
    // Spec §30.2: buyer's want N, seller's declared available M -> compatible iff N <= M.
    // The incoming talk's own declared tag tells us which side ITS declared quantity
    // represents: 'sell' means it declared what it HAS (M), so my own stored quantity is what
    // I WANT (N); anything else (e.g. 'buy') means it declared what it WANTS (N), so mine is
    // what I HAVE (M). Case-insensitive since the tag is free text, not a fixed enum; only the
    // literal 'sell' spelling resolves a direction today, same narrow scope as before.
    const isSell = tagContext.theirTag?.trim().toLowerCase() === 'sell';
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

  if (builtIn.kind === 'ageRange') {
    if (!builtIn.ageRange || !myPref.ageRange) return { action: 'ASK_USER' };
    return { action: 'ANSWER', compatible: ageRangeMutuallyAcceptable(builtIn.ageRange, myPref.ageRange) };
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
