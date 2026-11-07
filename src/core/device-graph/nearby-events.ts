/**
 * Nearby encounters and Place visits as events (spec §31.5, §31.7, §31.8; REQ-GRAPH-49, OPEN-110
 * slice 2, nearby half):
 *
 *   ev/<id>            { v, when, device, with: →person/<userId>, where: →cell/<region>, re? }  encounter
 *   ev/<id>            { v, when, device, place: →place/<id>, where: →cell/<region>, outing? }  visit
 *   place/<id>         { name?, anchor: →cell/<region>, firstSeen }       state, written once
 *   outing/<id>        { startedAt }                                      state, written once
 *   mine/enc/<person>  { ev: →the last encounter event, when }            repeat marker
 *   mine/visit/<id>    { ev: →the last visit event, when }                repeat marker
 *   ix/cell/<region>/ev   bucketed by day: every event carrying `where` (rebuilt in events.ts)
 *
 * Both events are chained like arrivals (no `by` → mine, REQ-GRAPH-40) and take the blurred-cell
 * `where` through the same `maybeStampWhere` locator path as Talk versions: the exact point lands
 * in the private `gps/<eventId>` sidecar, never on the event (REQ-GRAPH-42).
 */
import { putEvent } from './events';
import type { EventChainSigner } from './chain';
import { addToIndex } from './index-buckets';
import { parseEventId } from './event-id';
import { maybeStampWhere, type Locator } from './location-graph';
import { personIdOf, personSoul, personWrites } from './people-graph';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { GRAPH_SCHEMA_VERSION, graphSouls } from './talk-structure';
import type { EventIds } from './talk-events';

/**
 * A repeat encounter with the same person, or a repeat visit to the same place, inside this
 * window writes no new event: the last one stands (the BLE/Nearby layer fires continuously while
 * two devices stay in range, and one outing may sample a place every few minutes). The window is
 * a DEVICE-side dedupe only — the marker under `mine/` never leaves it.
 */
export const NEARBY_REPEAT_WINDOW_MS = 15 * 60_000;

/**
 * The ONE definition of the encounter/visit event shape (the events this module writes), shared
 * by the index writer (events.ts), the trim footprint (trim.ts) and this module: a `place` link
 * (a visit), or a bare `with` with no Talk/answer/message/deletion markers (an encounter).
 * Anything matching this and carrying a `where` cell is listed under `ix/cell/<region>/ev`.
 */
export function isNearbyEventShape(event: GraphNode, prefix = 'local/'): boolean {
  if (linkSoul(event.place)) return true;
  const withUser = personIdOf(prefix, linkSoul(event.with));
  return withUser !== ''
    && !linkSoul(event.talk) && !linkSoul(event.rev) && !linkSoul(event.gave)
    && !linkSoul(event.conv) && event.deleted !== true;
}

export function createNearbyGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number; chain?: EventChainSigner; locate?: Locator } = {}) {
  const souls = graphSouls(options.prefix);
  const prefix = options.prefix ?? 'local/';
  const now = options.now ?? Date.now;
  const placeSoul = (placeId: string) => `${prefix}place/${encodeURIComponent(placeId)}`;
  const outingSoul = (outingId: string) => `${prefix}outing/${encodeURIComponent(outingId)}`;

  /** The event id of the last record, when it still sits inside the repeat window. A backward
      clock jump makes the diff negative: fail OPEN (record a new event) rather than suppressing
      every encounter until real time catches up with the marker. */
  const recent = async (markerSoul: string, when: number): Promise<string | undefined> => {
    const marker = await store.get(markerSoul);
    const ev = linkSoul(marker?.ev);
    if (!ev?.startsWith(souls.event(''))) return undefined;
    const diff = when - Number(marker?.when ?? 0);
    return diff >= 0 && diff < NEARBY_REPEAT_WINDOW_MS ? ev.slice(souls.event('').length) : undefined;
  };

  /** The `ix/cell/<region>/ev` entry an event with a `where` implies (rebuilt in events.ts). */
  const cellIndex = (event: GraphNode, eventId: string, when: number): Array<Promise<unknown>> => {
    const cell = linkSoul(event.where);
    const head = `${prefix}cell/`;
    if (!cell?.startsWith(head)) return [];
    return [addToIndex(store, souls.index(`cell/${cell.slice(head.length)}/ev`), { key: eventId, target: souls.event(eventId), when }, 'day')];
  };

  return {
    /**
     * A Nearby encounter with this person (the Talk that brought us together in `re`, when it
     * came from one). A repeat inside NEARBY_REPEAT_WINDOW_MS returns the standing event's id.
     */
    async recordEncounter(encounter: { personUserId: string; re?: string }): Promise<string> {
      const when = now();
      const markerSoul = souls.mine(`enc/${encodeURIComponent(encounter.personUserId)}`);
      const standing = await recent(markerSoul, when);
      if (standing) return standing;
      const eventId = await ids.next(when);
      const event: GraphNode = {
        v: GRAPH_SCHEMA_VERSION, when, device: await ids.deviceId(),
        with: link(personSoul(prefix, encounter.personUserId)),
      };
      // `re` becomes a Gun link: it must be a real event id, never arbitrary caller text.
      if (encounter.re !== undefined && parseEventId(encounter.re) == null) throw new Error('invalid encounter re event id');
      if (encounter.re) event.re = link(souls.event(encounter.re));
      // `where` before putEvent: the chain signs the event with it (REQ-GRAPH-42).
      const whereSidecar = await maybeStampWhere(store, options, event, eventId);
      const people = await personWrites(store, prefix, [{ userId: encounter.personUserId }], when);
      await Promise.all([
        ...people.map(([soul, node]) => store.put(soul, node)),
        putEvent(store, souls, eventId, event, options.chain),
        store.put(markerSoul, { ev: link(souls.event(eventId)), when }),
        ...(whereSidecar ? [whereSidecar] : []),
        ...cellIndex(event, eventId, when),
      ]);
      return eventId;
    },

    /**
     * A visit to this place (`outingId`: one sample of that outing, spec §31.5). The `place/<id>`
     * state node is created once — a later visit never overwrites its name or first anchor — and
     * `outing/<id>` is created once with its start (its end is the outing feature's, later).
     * A repeat visit inside NEARBY_REPEAT_WINDOW_MS returns the standing event's id.
     */
    async recordVisit(visit: { placeId: string; name?: string; outingId?: string }): Promise<string> {
      const when = now();
      const markerSoul = souls.mine(`visit/${encodeURIComponent(visit.placeId)}`);
      const standing = await recent(markerSoul, when);
      if (standing) return standing;
      const eventId = await ids.next(when);
      const event: GraphNode = {
        v: GRAPH_SCHEMA_VERSION, when, device: await ids.deviceId(),
        place: link(placeSoul(visit.placeId)),
      };
      if (visit.outingId) event.outing = link(outingSoul(visit.outingId));
      const whereSidecar = await maybeStampWhere(store, options, event, eventId);
      const [place, outing] = await Promise.all([
        store.get(placeSoul(visit.placeId)),
        visit.outingId ? store.get(outingSoul(visit.outingId)) : Promise.resolve(null),
      ]);
      const once: Array<Promise<unknown>> = [];
      if (!place) {
        const node: GraphNode = { firstSeen: when };
        if (visit.name) node.name = visit.name;
        const anchor = linkSoul(event.where);
        if (anchor) node.anchor = link(anchor);
        once.push(store.put(placeSoul(visit.placeId), node));
      }
      if (visit.outingId && !outing) once.push(store.put(outingSoul(visit.outingId), { startedAt: when }));
      await Promise.all([
        ...once,
        putEvent(store, souls, eventId, event, options.chain),
        store.put(markerSoul, { ev: link(souls.event(eventId)), when }),
        ...(whereSidecar ? [whereSidecar] : []),
        ...cellIndex(event, eventId, when),
      ]);
      return eventId;
    },
  };
}
