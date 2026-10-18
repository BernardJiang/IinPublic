/**
 * OPEN-40 capacity experiment, deterministic part: adaptive shared-room split and coalescing at
 * 2, 498, 499 and 10,000 people for every candidate C, through the production split rule
 * (src/test/support/nearby-capacity-model.ts). The million-person runs and the measured tables are
 * in scripts/nearby-capacity-experiment.ts → docs/testing/nearby-capacity-experiment.md.
 */
import {
  checkDirectLinks,
  coalescePass,
  measure,
  newModel,
  pointNear,
  removeUsers,
  seededRandom,
  settleSplits,
} from '../support/nearby-capacity-model';
import type { GPSCoordinate } from '../../shared/types';

const CAPACITIES = [32, 64, 128, 256, 498, 1000] as const;
const K = 12;
const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
const PETCO_PARK = { latitude: 32.7076, longitude: -117.157 };
const LONDON = { latitude: 51.5072, longitude: -0.1276 };

function city(count: number, seed: number): GPSCoordinate[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => pointNear(SAN_DIEGO, 5_000, random));
}

/** 5,000 people in one stadium (below everyone's privacy floor) plus 5,000 across the city. */
function stadiumAndCity(): GPSCoordinate[] {
  const random = seededRandom(10_000);
  return [
    ...Array.from({ length: 5_000 }, () => pointNear(PETCO_PARK, 60, random)),
    ...city(5_000, 10_001),
  ];
}

describe('OPEN-40 adaptive Nearby capacity: 2, 498, 499 and 10,000 people', () => {
  test.each(CAPACITIES)('two people far apart share one room at C=%i', (capacity) => {
    const random = seededRandom(2);
    const state = newModel([pointNear(SAN_DIEGO, 10, random), pointNear(LONDON, 10, random)], capacity);
    settleSplits(state);
    expect(measure(state)).toMatchObject({ users: 2, rooms: 1, controlWrites: { splits: 0, coalesces: 0 } });
  });

  it('498 people in a city stay in one room at C=498; the 499th splits it, and nobody exceeds C', () => {
    const exact = newModel(city(498, 498), 498);
    settleSplits(exact);
    expect(measure(exact)).toMatchObject({ users: 498, rooms: 1, controlWrites: { splits: 0 } });

    const over = newModel(city(499, 498), 498);
    settleSplits(over);
    const metrics = measure(over);
    expect(metrics.users).toBe(499);
    expect(metrics.controlWrites.splits).toBeGreaterThanOrEqual(1);
    expect(metrics.occupancy.max).toBeLessThanOrEqual(498);
    expect(metrics.stuckOverflows).toBe(0);
  });

  test.each(CAPACITIES)('10,000 people (a stadium and a city) settle at or below C=%i, then coalesce when most leave', (capacity) => {
    const state = newModel(stadiumAndCity(), capacity);
    settleSplits(state);
    const settled = measure(state);
    expect(settled.users).toBe(10_000);
    expect(settled.occupancy.max).toBeLessThanOrEqual(capacity);
    expect(settled.stuckOverflows).toBe(0);
    // Each member reads only its own lineage, never the whole partition.
    expect(settled.controlReadsPerUser.max).toBeLessThanOrEqual(24);
    const links = checkDirectLinks(state, K, 20);
    expect(links.maxLinks).toBeLessThanOrEqual(K);
    expect(links.asymmetric).toBe(0);

    const random = seededRandom(capacity);
    const keep = new Set(state.users.map((_, index) => index).filter(() => random() < 0.1));
    removeUsers(state, (index) => keep.has(index));
    let passes = 0;
    while (coalescePass(state) > 0) passes += 1;
    const merged = measure(state);
    expect(merged.users).toBe(keep.size);
    expect(merged.occupancy.max).toBeLessThanOrEqual(capacity);
    expect(merged.rooms).toBeLessThan(settled.rooms);
    // Coalescing climbs at most one level per dwell.
    expect(passes).toBeLessThanOrEqual(settled.controlReadsPerUser.max);
  }, 60_000);
});
