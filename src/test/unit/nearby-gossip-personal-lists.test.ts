/**
 * Proposed Nearby v3 (docs/design/nearby-and-place-chatrooms.md §3.7), deterministic part: personal
 * nearby lists built by gossip converge, stay balanced, forget people who left, find a crowd across
 * a cell edge, and keep fake accounts to their fair share. Small C keeps it fast; the C = 498 and
 * 100,000-person runs are scripts/nearby-gossip-experiment.ts → docs/testing/nearby-gossip-experiment.md.
 */
import { pointNear, seededRandom } from '../support/seeded-random';
import {
  DEFAULT_GOSSIP_OPTIONS,
  gossipRound,
  measureAudience,
  measureViews,
  newGossipModel,
  removePeople,
  sampleViewers,
  type GossipOptions,
  type GossipVariant,
} from '../support/nearby-gossip-model';
import type { GPSCoordinate } from '../../shared/types';

const C = 32;
const SAN_DIEGO = { latitude: 32.7157, longitude: -117.1611 };
const PETCO_PARK = { latitude: 32.7076, longitude: -117.157 };

function options(variant: GossipVariant, seed: number, extra: Partial<GossipOptions> = {}): GossipOptions {
  return { ...DEFAULT_GOSSIP_OPTIONS, capacity: C, swapCards: 8, regionSeeds: 8, globalSeeds: 8, cellSeeds: 8, variant, seed, ...extra };
}

function around(center: { latitude: number; longitude: number }, sigma: number, count: number, seed: number): GPSCoordinate[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => pointNear(center, sigma, random));
}

describe('Nearby v3 personal lists (gossip model)', () => {
  test.each(['public-hash', 'secret-salt'] as const)('%s: 300 people in one city converge on their nearest C within 15 rounds', (variant) => {
    const state = newGossipModel(around(SAN_DIEGO, 5_000, 300, 1), options(variant, 1));
    const viewers = sampleViewers(state, 40);
    for (let round = 0; round < 15; round += 1) gossipRound(state);
    const metrics = measureViews(state, viewers);
    expect(metrics.fill).toBe(1);
    expect(metrics.distanceQuality).toBeGreaterThanOrEqual(0.95);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.9);
  });

  test('in an arena, per-viewer hash order spreads who is listed: nobody is on more than 2·C lists', () => {
    const state = newGossipModel(around(PETCO_PARK, 60, 1_000, 2), options('public-hash', 2));
    for (let round = 0; round < 30; round += 1) gossipRound(state);
    const audience = measureAudience(state);
    expect(audience.mean).toBe(C);
    expect(audience.max).toBeLessThanOrEqual(2 * C);
    expect(measureViews(state, sampleViewers(state, 40)).recall).toBeGreaterThanOrEqual(0.9);
  });

  test('cards of people who left without a goodbye are gone after the card lifetime', () => {
    const state = newGossipModel(around(SAN_DIEGO, 5_000, 300, 3), options('public-hash', 3));
    for (let round = 0; round < 10; round += 1) gossipRound(state);
    const random = seededRandom(4);
    removePeople(state, () => random() < 0.3);
    const viewers = sampleViewers(state, 40);
    expect(measureViews(state, viewers).stale).toBeGreaterThan(0.1);
    for (let round = 0; round <= DEFAULT_GOSSIP_OPTIONS.ttlRounds; round += 1) gossipRound(state);
    const after = measureViews(state, viewers);
    expect(after.stale).toBe(0);
    expect(after.fill).toBeGreaterThanOrEqual(0.9);
  });

  test('pyramid seeding starts a lone person nearer the crowd across their cell edge, and gossip finishes', () => {
    // 1,000 people in an arena, and 40 people alone within ~20 km of it in every direction.
    const random = seededRandom(5);
    const lone = Array.from({ length: 40 }, () => pointNear(PETCO_PARK, 12_000, random));
    const locations = [...around(PETCO_PARK, 60, 1_000, 6), ...lone];
    const focus = (index: number) => index >= 1_000;
    const pyramid = newGossipModel(locations, options('public-hash', 7, { seeding: 'pyramid' }));
    const region = newGossipModel(locations, options('public-hash', 7, { seeding: 'region' }));
    const viewers = sampleViewers(pyramid, 40, focus);
    expect(measureViews(pyramid, viewers).distanceQuality)
      .toBeGreaterThan(measureViews(region, sampleViewers(region, 40, focus)).distanceQuality);
    for (let round = 0; round < 5; round += 1) gossipRound(pyramid);
    const settled = measureViews(pyramid, viewers);
    expect(settled.fill).toBe(1);
    expect(settled.distanceQuality).toBeGreaterThanOrEqual(0.9);
  });

  test('public-hash: fake accounts that push only each other keep about their population share', () => {
    const state = newGossipModel(around(PETCO_PARK, 60, 1_000, 8), options('public-hash', 8), {
      sybil: (index) => index % 10 === 0,
    });
    for (let round = 0; round < 30; round += 1) gossipRound(state);
    const metrics = measureViews(state, sampleViewers(state, 40));
    expect(metrics.sybilShare).toBeLessThanOrEqual(0.15);
    expect(metrics.recall).toBeGreaterThanOrEqual(0.85);
  });
});
