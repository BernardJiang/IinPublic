import {
  createSignedP2PEnvelopeProof,
  type SeaSigningPair,
  type SignedP2PEnvelopeProof,
  verifySignedP2PEnvelopeProof,
} from './p2p-runtime';
import { isPublicLocation, type PublicLocation } from './public-location';

/**
 * Signed, short-lived "I am around here" record behind the map's user dots. It carries only the
 * public snapped point (public-location.ts), never a room id: a viewer colours a dot green when
 * the user is in its own room roster, yellow otherwise. `location: null` withdraws the dot at once
 * (privacy changed to Contacts only / Location off) instead of waiting for it to expire.
 */
export const MAP_PRESENCE_TTL_MS = 3 * 60_000;
export const MAP_PRESENCE_REFRESH_MS = 60_000;
export const MAP_PRESENCE_MAX_FUTURE_MS = 5_000;
/** Most dots one map query returns; a crowded view is trimmed, never unbounded. */
export const MAP_PRESENCE_QUERY_LIMIT = 500;

export type MapPresence = {
  version: 1;
  kind: 'map-presence';
  userId: string;
  pub: string;
  location: PublicLocation | null;
  /** Appears at a chosen point (✈) rather than blurred GPS (Resident). Self-declared. */
  traveler: boolean;
  observedAt: string;
  expiresAt: string;
  proof: SignedP2PEnvelopeProof;
};

/** What a map query returns per user: no keys, no proofs. */
export type MapPresenceDot = PublicLocation & { userId: string; traveler: boolean };

/** Anonymous headcount for one density square of the viewed area (heat-map input). */
export type MapDensityCell = { latitude: number; longitude: number; count: number };

/** The viewed area is cut into at most this many squares per side for the density layer. */
export const MAP_DENSITY_GRID = 48;

/**
 * Group points into squares of 1/MAP_DENSITY_GRID of the view's larger side (never finer than the
 * points themselves), so the response size depends on the view, not on how many people there are.
 */
export function densityCells(bounds: MapBounds, points: Iterable<{ latitude: number; longitude: number }>): MapDensityCell[] {
  const width = bounds.west <= bounds.east ? bounds.east - bounds.west : 360 - bounds.west + bounds.east;
  const step = Math.max(0.01, width / MAP_DENSITY_GRID, (bounds.north - bounds.south) / MAP_DENSITY_GRID);
  const cells = new Map<string, MapDensityCell>();
  for (const point of points) {
    const row = Math.floor(point.latitude / step);
    const column = Math.floor(point.longitude / step);
    const key = `${row}:${column}`;
    const cell = cells.get(key);
    if (cell) cell.count += 1;
    else cells.set(key, { latitude: (row + 0.5) * step, longitude: (column + 0.5) * step, count: 1 });
  }
  return [...cells.values()];
}

export type MapBounds = { west: number; south: number; east: number; north: number };

function signingPayload(record: Omit<MapPresence, 'proof'>): unknown {
  return {
    type: 'iinpublic-map-presence-v1',
    version: record.version,
    kind: record.kind,
    userId: record.userId,
    pub: record.pub,
    location: record.location,
    traveler: record.traveler,
    observedAt: record.observedAt,
    expiresAt: record.expiresAt,
  };
}

export async function createMapPresence(input: {
  userId: string;
  pair: SeaSigningPair;
  location: PublicLocation | null;
  traveler?: boolean;
  now?: Date;
}): Promise<MapPresence> {
  const now = input.now ?? new Date();
  const unsigned: Omit<MapPresence, 'proof'> = {
    version: 1,
    kind: 'map-presence',
    userId: String(input.userId || '').trim(),
    pub: String(input.pair.pub || '').trim(),
    location: input.location ? { ...input.location } : null,
    traveler: input.traveler === true,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MAP_PRESENCE_TTL_MS).toISOString(),
  };
  if (!unsigned.userId || !unsigned.pub) throw new Error('map presence needs userId and pub');
  if (unsigned.location && !isPublicLocation(unsigned.location)) throw new Error('map presence point is not a public grid centre');
  const proof = await createSignedP2PEnvelopeProof({
    pair: input.pair,
    payload: signingPayload(unsigned),
    timestamp: unsigned.observedAt,
  });
  return { ...unsigned, proof };
}

export function parseMapPresence(value: unknown): MapPresence | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<MapPresence>;
  if (record.version !== 1
    || record.kind !== 'map-presence'
    || typeof record.userId !== 'string' || record.userId.length < 1 || record.userId.length > 256
    || typeof record.pub !== 'string' || record.pub.length < 1 || record.pub.length > 2_048
    || (record.location !== null && !isPublicLocation(record.location))
    || typeof record.traveler !== 'boolean'
    || typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt))
    || typeof record.expiresAt !== 'string' || !Number.isFinite(Date.parse(record.expiresAt))
    || !record.proof
    || record.proof.pub !== record.pub) return null;
  return record as MapPresence;
}

export async function verifyMapPresence(
  value: unknown,
  at: Date = new Date(),
): Promise<{ ok: true; record: MapPresence } | { ok: false; reason: string }> {
  const record = parseMapPresence(value);
  if (!record) return { ok: false, reason: 'malformed map presence' };
  const observedAt = Date.parse(record.observedAt);
  const expiresAt = Date.parse(record.expiresAt);
  if (observedAt > at.getTime() + MAP_PRESENCE_MAX_FUTURE_MS) return { ok: false, reason: 'map presence is from the future' };
  if (expiresAt <= at.getTime() || expiresAt !== observedAt + MAP_PRESENCE_TTL_MS) {
    return { ok: false, reason: 'expired or invalid map presence lifetime' };
  }
  const verification = await verifySignedP2PEnvelopeProof({
    proof: record.proof,
    payload: signingPayload(record),
    now: at,
    maxSkewMs: MAP_PRESENCE_TTL_MS,
  });
  return verification.ok ? { ok: true, record } : verification;
}

export function parseMapBounds(query: Record<string, unknown>): MapBounds | null {
  const bounds = {
    west: Number(query.west),
    south: Number(query.south),
    east: Number(query.east),
    north: Number(query.north),
  };
  if (![bounds.west, bounds.east].every((value) => Number.isFinite(value) && Math.abs(value) <= 180)
    || ![bounds.south, bounds.north].every((value) => Number.isFinite(value) && Math.abs(value) <= 90)
    || bounds.south > bounds.north) return null;
  return bounds;
}

/** `west > east` means the view crosses the antimeridian. */
export function boundsContain(bounds: MapBounds, point: { latitude: number; longitude: number }): boolean {
  if (point.latitude < bounds.south || point.latitude > bounds.north) return false;
  return bounds.west <= bounds.east
    ? point.longitude >= bounds.west && point.longitude <= bounds.east
    : point.longitude >= bounds.west || point.longitude <= bounds.east;
}
