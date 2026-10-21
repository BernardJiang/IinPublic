import type { GPSCoordinate } from '../../shared/types';

const TIMESTAMP = new Date('2026-10-17T12:00:00.000Z');

/** A tiny deterministic PRNG (mulberry32), so every run of an experiment is identical. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** A point scattered around `center` with a normal spread of `sigmaMeters`. */
export function pointNear(center: { latitude: number; longitude: number }, sigmaMeters: number, random: () => number): GPSCoordinate {
  const metersPerDegree = 111_320;
  const latitude = center.latitude + (gaussian(random) * sigmaMeters) / metersPerDegree;
  const longitude = center.longitude
    + (gaussian(random) * sigmaMeters) / (metersPerDegree * Math.cos((center.latitude * Math.PI) / 180));
  return {
    latitude: Math.max(-84, Math.min(84, latitude)),
    longitude: ((longitude + 540) % 360) - 180,
    accuracy: 10,
    timestamp: TIMESTAMP,
  };
}
