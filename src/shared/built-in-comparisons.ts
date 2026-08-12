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
