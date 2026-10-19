/**
 * Nearby v3 tunables (docs/design/nearby-and-place-chatrooms.md §3.7). Every value can be changed by
 * the signed protocol manifest without a new release: `C` is the manifest's `chatroomCapacity`, the
 * rest come from its `extensions['nearby-v3']` object. The numbers below are only what a phone uses
 * until a manifest says otherwise; code and tests take a config, never these constants directly.
 */
export const NEARBY_V3_MANIFEST_EXTENSION = 'nearby-v3';

export type NearbyV3Config = {
  /** Most people on one personal list (C). */
  capacity: number;
  /** One gossip swap per period. */
  gossipPeriodMs: number;
  /** Cards each side sends in one swap (own card included). */
  swapCards: number;
  /** A card is valid this long after it is signed. */
  cardLifetimeMs: number;
  /** The owner signs a fresh card this often. */
  cardReissueMs: number;
  /**
   * A swap re-sends a card the other side already holds only when the sender's copy is at least
   * this much newer (the other side's digest says how old its copy is).
   */
  cardRefreshMs: number;
  /** Cards the hub keeps per pyramid cell: a rotating sample, never a member list. */
  hubCellSample: number;
  /** Finest pyramid level: the privacy-floor cell level (2^15 cells around the world ≈ 1.2 km). */
  pyramidFinestLevel: number;
  /** Most concurrent incoming broadcast connections a phone accepts; the rest retry later. */
  incomingConnections: number;
  /** Most new Talks a phone accepts per minute from people it has no conversation with. */
  incomingTalksPerMinute: number;
  /** The broadcast loop starts with this many contacts at a time and adapts. */
  broadcastInitialConcurrency: number;
  broadcastMaxConcurrency: number;
};

export const NEARBY_V3_DEFAULTS: Readonly<NearbyV3Config> = Object.freeze({
  capacity: 498,
  gossipPeriodMs: 30_000,
  swapCards: 32,
  cardLifetimeMs: 15 * 60_000,
  cardReissueMs: 3 * 60_000,
  cardRefreshMs: 5 * 60_000,
  hubCellSample: 64,
  pyramidFinestLevel: 15,
  incomingConnections: 8,
  incomingTalksPerMinute: 60,
  broadcastInitialConcurrency: 4,
  broadcastMaxConcurrency: 16,
});

/** Accepted range per tunable; a manifest value outside it is ignored (the default stays). */
const BOUNDS: { [K in keyof NearbyV3Config]: [number, number] } = {
  capacity: [2, 10_000],
  gossipPeriodMs: [5_000, 600_000],
  swapCards: [2, 256],
  cardLifetimeMs: [60_000, 6 * 3_600_000],
  cardReissueMs: [10_000, 3_600_000],
  cardRefreshMs: [10_000, 3_600_000],
  hubCellSample: [1, 1_024],
  pyramidFinestLevel: [4, 20],
  incomingConnections: [1, 256],
  incomingTalksPerMinute: [1, 10_000],
  broadcastInitialConcurrency: [1, 256],
  broadcastMaxConcurrency: [1, 256],
};

function inBounds(key: keyof NearbyV3Config, value: unknown): value is number {
  const [min, max] = BOUNDS[key];
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
}

/**
 * The config a manifest describes: `chatroomCapacity` is C, `extensions['nearby-v3']` overrides any
 * other tunable. Unknown or out-of-range values are ignored. A card must outlive its reissue period,
 * or lists would empty between reissues; such a pair falls back to the defaults.
 */
export function nearbyV3ConfigFromManifest(manifest: {
  chatroomCapacity?: number;
  extensions?: Record<string, unknown>;
} | null | undefined): NearbyV3Config {
  const config: NearbyV3Config = { ...NEARBY_V3_DEFAULTS };
  if (inBounds('capacity', manifest?.chatroomCapacity)) config.capacity = manifest!.chatroomCapacity!;
  const extension = manifest?.extensions?.[NEARBY_V3_MANIFEST_EXTENSION];
  if (extension && typeof extension === 'object' && !Array.isArray(extension)) {
    for (const key of Object.keys(BOUNDS) as Array<keyof NearbyV3Config>) {
      if (key === 'capacity') continue;
      const value = (extension as Record<string, unknown>)[key];
      if (inBounds(key, value)) config[key] = value;
    }
  }
  if (config.cardReissueMs * 2 > config.cardLifetimeMs) {
    config.cardReissueMs = NEARBY_V3_DEFAULTS.cardReissueMs;
    config.cardLifetimeMs = NEARBY_V3_DEFAULTS.cardLifetimeMs;
  }
  config.broadcastInitialConcurrency = Math.min(config.broadcastInitialConcurrency, config.broadcastMaxConcurrency);
  return config;
}
