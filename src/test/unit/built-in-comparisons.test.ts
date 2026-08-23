import {
  ageRangeMutuallyAcceptable,
  intervalsOverlap,
  locationsMutuallyContained,
  mutualPreferenceSetMembership,
  quantitySufficient,
} from '../../shared/built-in-comparisons';
import { haversineMilesBetween } from '../../shared/talk-intake-filters';

describe('intervalsOverlap', () => {
  it('overlaps when ranges genuinely intersect (non-identical, real overlap)', () => {
    expect(intervalsOverlap({ min: 100, max: 300 }, { min: 200, max: 400 })).toBe(true);
  });

  it('overlaps when one range fully nests inside the other', () => {
    expect(intervalsOverlap({ min: 0, max: 1000 }, { min: 300, max: 500 })).toBe(true);
    expect(intervalsOverlap({ min: 300, max: 500 }, { min: 0, max: 1000 })).toBe(true);
  });

  it('overlaps when ranges are identical', () => {
    expect(intervalsOverlap({ min: 300, max: 500 }, { min: 300, max: 500 })).toBe(true);
  });

  it('counts touching endpoints as overlapping (closed intervals)', () => {
    expect(intervalsOverlap({ min: 100, max: 300 }, { min: 300, max: 500 })).toBe(true);
    expect(intervalsOverlap({ min: 300, max: 500 }, { min: 100, max: 300 })).toBe(true);
  });

  it('does not overlap when ranges are disjoint', () => {
    expect(intervalsOverlap({ min: 100, max: 200 }, { min: 300, max: 400 })).toBe(false);
    expect(intervalsOverlap({ min: 300, max: 400 }, { min: 100, max: 200 })).toBe(false);
  });

  it('works identically for timeFrame-shaped (epoch ms) values, not just price', () => {
    const start1 = new Date('2026-09-01').getTime();
    const end1 = new Date('2026-09-30').getTime();
    const start2 = new Date('2026-09-15').getTime();
    const end2 = new Date('2026-10-15').getTime();
    expect(intervalsOverlap({ min: start1, max: end1 }, { min: start2, max: end2 })).toBe(true);

    const start3 = new Date('2026-11-01').getTime();
    const end3 = new Date('2026-11-30').getTime();
    expect(intervalsOverlap({ min: start1, max: end1 }, { min: start3, max: end3 })).toBe(false);
  });
});

describe('quantitySufficient', () => {
  it('is sufficient when want equals have (N == M)', () => {
    expect(quantitySufficient(5, 5)).toBe(true);
  });

  it('is sufficient when want is less than have (N < M)', () => {
    expect(quantitySufficient(3, 5)).toBe(true);
  });

  it('is not sufficient when want exceeds have (N > M)', () => {
    expect(quantitySufficient(6, 5)).toBe(false);
  });

  it('is not symmetric — (have, want) is not the same call as (want, have)', () => {
    expect(quantitySufficient(3, 5)).toBe(true);
    expect(quantitySufficient(5, 3)).toBe(false);
  });
});

describe('locationsMutuallyContained', () => {
  // ~0.62 miles apart (rough same-city offset).
  const near = { latitude: 37.7749, longitude: -122.4194 };
  const nearNeighbor = { latitude: 37.785, longitude: -122.41 };
  // Far away (different state).
  const far = { latitude: 34.0522, longitude: -118.2437 };

  it('is contained when both sides declare a radius that reaches the other', () => {
    const a = { authorLocation: near, locationRadiusMiles: 5 };
    const b = { authorLocation: nearNeighbor, locationRadiusMiles: 5 };
    expect(locationsMutuallyContained(a, b)).toBe(true);
  });

  it('is not contained when one side has an asymmetric radius too small to reach', () => {
    const a = { authorLocation: near, locationRadiusMiles: 5 };
    const b = { authorLocation: nearNeighbor, locationRadiusMiles: 0.1 };
    expect(locationsMutuallyContained(a, b)).toBe(false);
    // Symmetric check: the shortfall on b's side still blocks it even if a's radius is huge.
    const aHuge = { authorLocation: near, locationRadiusMiles: 1000 };
    expect(locationsMutuallyContained(aHuge, b)).toBe(false);
  });

  it('is contained exactly at the boundary distance (<=, not <)', () => {
    // Use the actual computed distance as both radii — boundary case must pass.
    const distance = haversineMilesBetween(near, nearNeighbor);
    const a = { authorLocation: near, locationRadiusMiles: distance };
    const b = { authorLocation: nearNeighbor, locationRadiusMiles: distance };
    expect(locationsMutuallyContained(a, b)).toBe(true);
  });

  it('is not contained when locations are far apart even with generous but insufficient radii', () => {
    const a = { authorLocation: near, locationRadiusMiles: 50 };
    const b = { authorLocation: far, locationRadiusMiles: 50 };
    expect(locationsMutuallyContained(a, b)).toBe(false);
  });

  it('is not contained (fails closed) when either side is missing a location', () => {
    expect(locationsMutuallyContained({ locationRadiusMiles: 5 }, { authorLocation: near, locationRadiusMiles: 5 })).toBe(false);
    expect(locationsMutuallyContained({ authorLocation: near, locationRadiusMiles: 5 }, { locationRadiusMiles: 5 })).toBe(false);
  });

  it('is not contained (fails closed) when either side is missing a radius', () => {
    expect(locationsMutuallyContained({ authorLocation: near }, { authorLocation: nearNeighbor, locationRadiusMiles: 5 })).toBe(false);
    expect(locationsMutuallyContained({ authorLocation: near, locationRadiusMiles: 5 }, { authorLocation: nearNeighbor })).toBe(false);
  });
});

describe('ageRangeMutuallyAcceptable', () => {
  it('accepts when each side\'s age falls within the other\'s acceptable range', () => {
    const a = { age: 30, acceptableRange: { min: 25, max: 35 } };
    const b = { age: 28, acceptableRange: { min: 20, max: 40 } };
    expect(ageRangeMutuallyAcceptable(a, b)).toBe(true);
  });

  it('rejects when only one direction is acceptable', () => {
    // a accepts b's age (28 in [25,35]), but b does not accept a's age (30 not in [20,27]).
    const a = { age: 30, acceptableRange: { min: 25, max: 35 } };
    const b = { age: 28, acceptableRange: { min: 20, max: 27 } };
    expect(ageRangeMutuallyAcceptable(a, b)).toBe(false);
  });

  it('rejects when neither direction is acceptable', () => {
    const a = { age: 50, acceptableRange: { min: 45, max: 55 } };
    const b = { age: 22, acceptableRange: { min: 20, max: 25 } };
    expect(ageRangeMutuallyAcceptable(a, b)).toBe(false);
  });

  it('treats the acceptable range as inclusive (boundary ages accepted)', () => {
    const a = { age: 25, acceptableRange: { min: 20, max: 30 } };
    const b = { age: 30, acceptableRange: { min: 25, max: 25 } };
    expect(ageRangeMutuallyAcceptable(a, b)).toBe(true);
  });

  it('is symmetric — order of arguments does not change the result', () => {
    const a = { age: 30, acceptableRange: { min: 25, max: 35 } };
    const b = { age: 28, acceptableRange: { min: 20, max: 40 } };
    expect(ageRangeMutuallyAcceptable(a, b)).toBe(ageRangeMutuallyAcceptable(b, a));
  });
});

describe('mutualPreferenceSetMembership', () => {
  it('accepts when each side\'s preferenceSet includes the other\'s selfTag', () => {
    const a = { selfTag: 'buy', preferenceSet: ['sell'] };
    const b = { selfTag: 'sell', preferenceSet: ['buy'] };
    expect(mutualPreferenceSetMembership(a, b)).toBe(true);
  });

  it('rejects when only one direction is accepted', () => {
    const a = { selfTag: 'buy', preferenceSet: ['sell'] };
    const b = { selfTag: 'rent', preferenceSet: ['buy'] };
    expect(mutualPreferenceSetMembership(a, b)).toBe(false);
  });

  it('an empty/absent preferenceSet means "accepts anyone," not "accepts no one"', () => {
    const noPreference = { selfTag: 'buy', preferenceSet: [] };
    const other = { selfTag: 'anything', preferenceSet: ['buy'] };
    expect(mutualPreferenceSetMembership(noPreference, other)).toBe(true);
    expect(mutualPreferenceSetMembership({ selfTag: 'buy' }, other)).toBe(true);
  });

  it('matches the existing one-directional veto\'s permissive default: a missing counterpart selfTag passes, even when this side declares a preference', () => {
    const a = { selfTag: 'buy', preferenceSet: ['sell'] };
    const bNoSelfTag = { preferenceSet: [] };
    expect(mutualPreferenceSetMembership(a, bNoSelfTag)).toBe(true);
  });

  it('rejects only the direction that actually excludes, not both, when preferences differ in strictness', () => {
    // b has no preference (accepts anyone); a excludes b's tag.
    const a = { selfTag: 'buy', preferenceSet: ['sell'] };
    const b = { selfTag: 'rent', preferenceSet: [] };
    expect(mutualPreferenceSetMembership(a, b)).toBe(false);
  });
});
