/**
 * §BB / spec §30.2: pure comparison functions for the 3 typed built-in question kinds
 * (quantity, priceRange/timeFrame share interval-overlap, location). Each function answers
 * exactly the "compatible or not" question that picks between `TalkAutofix`'s 2 synthetic
 * answers (see `types.ts`'s `Question.builtIn` doc comment) — no partial/scored result, per
 * the all-or-nothing decision recorded in `docs/TODO.md` §BB.
 */
import { haversineMilesBetween } from './talk-intake-filters';

export interface NumericInterval {
  min: number;
  max: number;
}

/**
 * True iff the two closed intervals share at least one point — `a.min <= b.max && b.min <=
 * a.max`. Touching endpoints count as overlapping. Shared by `priceRange` (dollars) and
 * `timeFrame` (epoch ms): both are plain numeric ranges, just different units.
 */
export function intervalsOverlap(a: NumericInterval, b: NumericInterval): boolean {
  return a.min <= b.max && b.min <= a.max;
}

/**
 * True iff a requesting side's want `N` is satisfiable by a declaring side's available `M`
 * (`N <= M`). Not symmetric — call with (want, have), not (have, want).
 */
export function quantitySufficient(want: number, have: number): boolean {
  return want <= have;
}

export interface LocationForContainment {
  authorLocation?: { latitude: number; longitude: number } | null;
  locationRadiusMiles?: number | null;
}

/**
 * Mutual containment: true iff the distance between the two sides is within BOTH sides'
 * declared radius (`distance <= a.radiusMiles && distance <= b.radiusMiles`) — the simplest
 * reading decided in TODO.md §BB, not the looser "combined radii overlap." Reuses
 * `haversineMilesBetween` and each side's own already-blurred `Talk.authorLocation` /
 * `Talk.locationRadiusMiles` (no per-question coordinates, see `Question.builtIn`). Returns
 * false — not the same as "compatible" — when either side lacks a location or a radius,
 * matching the existing intake-filter location check's "can't compute, don't silently pass"
 * posture; callers distinguish this from a genuine incompatibility via their own missing-data
 * check before calling in, same as every other builtIn comparison.
 */
export function locationsMutuallyContained(a: LocationForContainment, b: LocationForContainment): boolean {
  if (!a.authorLocation || !b.authorLocation) return false;
  if (a.locationRadiusMiles == null || b.locationRadiusMiles == null) return false;
  const distance = haversineMilesBetween(a.authorLocation, b.authorLocation);
  return distance <= a.locationRadiusMiles && distance <= b.locationRadiusMiles;
}

/**
 * §DD / spec §30.3, §30.6: `ageRange`'s comparison is a THIRD primitive, distinct from
 * `intervalsOverlap` — one side of the comparison is a single fact (an actual declared age),
 * not a range either side is offering. Each side states their own age and their own acceptable
 * partner-age range; a match requires each side's age to fall within the OTHER side's
 * acceptable range, checked in both directions (mutual, same precedence spec §30.7 gives
 * gender/race). `min`/`max` are treated as an inclusive closed range, same convention
 * `intervalsOverlap` already uses for price/time.
 */
export interface AgeAndAcceptableRange {
  age: number;
  acceptableRange: NumericInterval;
}

export function ageRangeMutuallyAcceptable(a: AgeAndAcceptableRange, b: AgeAndAcceptableRange): boolean {
  const aAcceptsB = b.age >= a.acceptableRange.min && b.age <= a.acceptableRange.max;
  const bAcceptsA = a.age >= b.acceptableRange.min && a.age <= b.acceptableRange.max;
  return aAcceptsB && bAcceptsA;
}

/**
 * §DD / spec §30.2, §30.7: mutual preference-set membership — generalizes `checkIfMatch`'s
 * existing one-directional `preferenceSet` veto (talk-engine.ts, checked only from the talk
 * author's side against the responder's `selfTag`) to a real two-sided check, needed once a
 * comparison has BOTH parties' own declared (selfTag, preferenceSet) pairs available (e.g. a
 * dating talk's mutual gender/race preference, spec §30.6 — "kept symmetric with every other
 * hard criterion," §30.7). An empty/absent `preferenceSet` means "no preference — accepts
 * anyone" (the established default posture, spec §30.2/§30.6), not "accepts no one." Matches
 * the existing one-directional veto's exact permissive default for a missing counterpart
 * `selfTag` too — `checkIfMatch`'s own check only vetoes when `responderSelfTag` is present
 * AND excluded, so "the other side declared no self-tag at all" already passes today and must
 * keep passing here, in either direction.
 */
export interface SelfTagAndPreferenceSet {
  selfTag?: string;
  preferenceSet?: string[];
}

export function mutualPreferenceSetMembership(a: SelfTagAndPreferenceSet, b: SelfTagAndPreferenceSet): boolean {
  const aAcceptsB =
    !a.preferenceSet || a.preferenceSet.length === 0 || !b.selfTag || a.preferenceSet.includes(b.selfTag);
  const bAcceptsA =
    !b.preferenceSet || b.preferenceSet.length === 0 || !a.selfTag || b.preferenceSet.includes(a.selfTag);
  return aAcceptsB && bAcceptsA;
}
