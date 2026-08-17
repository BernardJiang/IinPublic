/**
 * Closest-match selection for `role: 'offer'/'request'` marketplace-style talks (taxi
 * driver/passenger, dealmaker, etc.) — when several candidates with identical content arrive
 * from different authors within a short window, pick the nearest one instead of matching
 * whichever happened to arrive first. Pure functions only; the staging/debounce/mesh-response
 * plumbing lives in `IinPublicApp` (`src/web/app/app.ts`).
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
