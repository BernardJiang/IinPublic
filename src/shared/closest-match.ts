/**
 * Closest-match distance ranking for preference-set-based marketplace-style talks (taxi
 * driver/passenger, dealmaker, buy/sell, etc.) — a pure, unit-tested helper for ranking several
 * same-content candidates by distance. Not currently wired into any auto-reject flow (matches
 * aren't exclusive; the deal-confirmation feature is what finalizes one — see `app.ts`); kept
 * as a reusable building block for an optional future "sort open marketplace conversations by
 * distance" UI.
 */
import { haversineMilesBetween } from './talk-intake-filters';

export interface ClosestMatchCandidate {
  talkId: string;
  authorId: string;
  authorLocation?: { latitude: number; longitude: number } | null;
}

export interface ClosestMatchResult {
  winner: ClosestMatchCandidate;
  losers: ClosestMatchCandidate[];
  distanceMiles: number | null;
}

/**
 * Picks the candidate nearest to `referenceLocation`. Candidates missing `authorLocation` sort
 * last (treated as farthest, not excluded) so a location-less candidate can still win when it's
 * the only one available. Ties keep the earliest-arrived candidate (stable — `candidates` is
 * expected in arrival order). Returns `null` only for an empty candidate list.
 */
export function pickClosestCandidate(
  candidates: ClosestMatchCandidate[],
  referenceLocation: { latitude: number; longitude: number } | null | undefined,
): ClosestMatchResult | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { winner: candidates[0], losers: [], distanceMiles: null };
  }

  const distanceOf = (c: ClosestMatchCandidate): number => {
    if (!referenceLocation || !c.authorLocation) return Number.POSITIVE_INFINITY;
    return haversineMilesBetween(referenceLocation, c.authorLocation);
  };

  let winnerIndex = 0;
  let winnerDistance = distanceOf(candidates[0]);
  for (let i = 1; i < candidates.length; i += 1) {
    const distance = distanceOf(candidates[i]);
    if (distance < winnerDistance) {
      winnerIndex = i;
      winnerDistance = distance;
    }
  }

  const winner = candidates[winnerIndex];
  const losers = candidates.filter((_, i) => i !== winnerIndex);
  return {
    winner,
    losers,
    distanceMiles: Number.isFinite(winnerDistance) ? winnerDistance : null,
  };
}
