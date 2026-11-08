/**
 * Places and location in the device graph (spec §31.7).
 *
 *   cell/<region>   { v, latitude, longitude, precisionMeters, parent?: →cell/<wider> }   content-like
 *   gps/<id>        { v, latitude, longitude, accuracy?, source, when }                   private, deletable
 *   ix/gps          bucketed by day: <id> → gps/<id>
 *
 * An event names where it happened by a blurred cell (`where: →cell/<region>`), never by an exact
 * point: events never change, and an exact point must be deletable. The exact point sits in
 * `gps/<id>` (the id of the event it belongs to) and is erased after 30 days (owner decision
 * 2026-11-03), leaving only the cell.
 */
import { PUBLIC_LOCATION_PRECISIONS, publicLocationRegion, snapPublicLocation } from '../../shared/public-location';
import { addToIndex, bucketOf } from './index-buckets';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { GRAPH_SCHEMA_VERSION } from './talk-structure';

export const GPS_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
/** A cell's parent is the same point at the next precision (spec §31.7). */
const PRECISION_LADDER = PUBLIC_LOCATION_PRECISIONS;

export type GpsPoint = { latitude: number; longitude: number; accuracy?: number | undefined; source: 'gps' | 'traveler' };

/**
 * Stamp an event I write with where it happened (REQ-GRAPH-42): `where` links the blurred cell,
 * never the exact point (spec §31.7 — events never change, an exact point must be deletable).
 * Returns the private `gps/<eventId>` sidecar write for the caller to batch with the event write.
 */
export async function stampEventWhere(location: ReturnType<typeof createLocationGraph>, prefix: string, point: GpsPoint, event: GraphNode, eventId: string): Promise<Promise<unknown>> {
  event.where = link(`${prefix}cell/${await location.cell(point)}`);
  return location.record(eventId, point);
}

/** Where the device currently is, as the host knows it (undefined: no fix / no provider). */
export type Locator = () => Promise<GpsPoint | undefined>;

/** A reported fix older than this is not used to stamp an event: the device may have moved since. */
export const REPORTED_FIX_MAX_AGE_MS = 60 * 60_000;

/**
 * A locator fed by the app (REQ-GRAPH-42): a core with no geolocation of its own — the web
 * worker, a phone's embedded node — learns where the device is from the page, which reports each
 * new fix and `null` when location is off. A fix older than `maxAgeMs` is not used.
 */
export function createReportedLocation(options: { now?: () => number; maxAgeMs?: number } = {}) {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? REPORTED_FIX_MAX_AGE_MS;
  let fix: { point: GpsPoint; at: number } | undefined;
  return {
    /** The page's latest fix, or `null`: location is off or there is no fix. A malformed point clears it. */
    set(point: unknown): void {
      fix = undefined;
      if (!point || typeof point !== 'object') return;
      const p = point as Record<string, unknown>;
      const latitude = Number(p.latitude);
      const longitude = Number(p.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return;
      const accuracy = Number(p.accuracy);
      fix = {
        point: { latitude, longitude, source: p.source === 'traveler' ? 'traveler' : 'gps', ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}) },
        at: now(),
      };
    },
    locate: (async () => (fix && now() - fix.at <= maxAgeMs ? { ...fix.point } : undefined)) as Locator,
  };
}

/**
 * Stamp an event with the current blurred cell when the host knows where the device is
 * (REQ-GRAPH-42). A missing or failing locator never blocks the write. Returns the gps sidecar
 * write to batch with the event, or undefined when there is nothing to record.
 */
export async function maybeStampWhere(store: NodeStore, options: { prefix?: string; locate?: Locator }, event: GraphNode, eventId: string): Promise<Promise<unknown> | undefined> {
  if (!options.locate) return undefined;
  let point: GpsPoint | undefined;
  try { point = await options.locate(); } catch { return undefined; }
  if (!point) return undefined;
  return stampEventWhere(createLocationGraph(store, options), options.prefix ?? 'local/', point, event, eventId);
}

export function createLocationGraph(store: NodeStore, options: { prefix?: string; now?: () => number } = {}) {
  const prefix = options.prefix ?? 'local/';
  const now = options.now ?? Date.now;
  const cellSoul = (region: string) => `${prefix}cell/${region}`;
  const gpsSoul = (id: string) => `${prefix}gps/${id}`;
  const gpsList = `${prefix}ix/gps`;

  return {
    /**
     * The cell of a point at the finest public precision, with its wider parents, written once
     * each. Returns the region to put in an event's `where`.
     */
    async cell(point: { latitude: number; longitude: number }): Promise<string> {
      const regions = PRECISION_LADDER.map((precision) => publicLocationRegion(snapPublicLocation(point, precision)));
      const nodes = PRECISION_LADDER.map((precision, i): [string, GraphNode] => {
        const snapped = snapPublicLocation(point, precision);
        const node: GraphNode = { v: GRAPH_SCHEMA_VERSION, latitude: snapped.latitude, longitude: snapped.longitude, precisionMeters: precision };
        if (regions[i + 1]) node.parent = link(cellSoul(regions[i + 1]!));
        return [cellSoul(regions[i]!), node];
      });
      const exists = await Promise.all(nodes.map(([soul]) => store.get(soul)));
      await Promise.all(nodes.filter((_, i) => !exists[i]).map(([soul, node]) => store.put(soul, node)));
      return regions[0]!;
    },

    /** Keep the exact point of an event (its id) for the retention period. */
    async record(eventId: string, point: GpsPoint, when = now()): Promise<void> {
      const node: GraphNode = { v: GRAPH_SCHEMA_VERSION, latitude: point.latitude, longitude: point.longitude, source: point.source, when };
      if (typeof point.accuracy === 'number' && Number.isFinite(point.accuracy)) node.accuracy = point.accuracy;
      await Promise.all([store.put(gpsSoul(eventId), node), addToIndex(store, gpsList, { key: eventId, target: gpsSoul(eventId), when }, 'day')]);
    },

    async point(eventId: string): Promise<GpsPoint | undefined> {
      const node = await store.get(gpsSoul(eventId));
      if (!node || typeof node.latitude !== 'number' || typeof node.longitude !== 'number') return undefined;
      const point: GpsPoint = { latitude: node.latitude, longitude: node.longitude, source: node.source === 'traveler' ? 'traveler' : 'gps' };
      if (typeof node.accuracy === 'number') point.accuracy = node.accuracy;
      return point;
    },

    /**
     * Erase every exact point older than the retention period: the point's fields, its index entry
     * and the emptied day bucket. Whole days only, so the cost is one read per old day. Returns how
     * many points were erased.
     */
    async sweep(options: { retentionDays?: number } = {}): Promise<number> {
      const cutoff = bucketOf(now() - (options.retentionDays ?? GPS_RETENTION_DAYS) * DAY_MS, 'day');
      const directory = await store.get(gpsList);
      let erased = 0;
      for (const bucket of Object.keys(directory || {}).filter((b) => b < cutoff && linkSoul(directory![b])).sort()) {
        const bucketSoul = linkSoul(directory![bucket])!;
        const entries = await store.get(bucketSoul);
        const ids = Object.keys(entries || {}).filter((id) => linkSoul(entries![id]));
        await Promise.all(ids.map((id) => store.put(gpsSoul(id), { latitude: null, longitude: null, accuracy: null, source: null, when: null })));
        await store.put(bucketSoul, Object.fromEntries(ids.map((id) => [id, null])));
        await store.put(gpsList, { [bucket]: null });
        erased += ids.length;
      }
      return erased;
    },
  };
}
