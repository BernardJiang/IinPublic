/**
 * Talks as events (spec §31.3, §31.5, D14, D16). A Talk's id is the id of the event that first
 * wrote it; every edit is a new event of the same Talk (`talk` → the first event, `re` → the
 * version before). The structure lives in `rev/<hash>`; the event carries only what is not
 * structure: title, delivery fields and when.
 *
 *   ev/<talkId>        { v, when, device, rev: →rev/…, title, isAdult, expiresAt?, locationRadiusMiles? }
 *   ev/<editId>        { …the same, talk: →ev/<talkId>, re: →ev/<previous> }
 *   ev/<deleteId>      { v, when, device, talk: →ev/<talkId>, re: →ev/<latest>, deleted: true }
 *   mine/talk/<talkId> { latest: →ev/…, active, isTemplate, deleted? }             state
 *   ix/mine-talks      bucketed list of my Talks, by the Talk's first event time
 */
import { putEvent } from './events';
import type { EventChainSigner } from './chain';
import { addToIndex, readIndex, removeFromIndex } from './index-buckets';
import { parseEventId } from './event-id';
import { personIdOf } from './people-graph';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { GRAPH_SCHEMA_VERSION, builtInValues, graphSouls, questionKeysOf, readTalkStructure, talkStructureOf, typedIndexKey, writeTalkStructure, type TalkStructure } from './talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EventIds = { next(when?: number): Promise<string>; deviceId(): Promise<string> };

export type GraphTalk = TalkStructure & {
  id: string;
  title: string;
  isAdult: boolean;
  expiresAt?: number;
  locationRadiusMiles?: number;
  /** The first event's time (the Talk's creation). */
  createdAt: number;
  /** The latest version's event id and time. */
  versionId: string;
  updatedAt: number;
  active: boolean;
  isTemplate: boolean;
  /** The Talk's other fields the app shows (tags, attachments, author name), see `TALK_META_FIELDS`. */
  meta?: Record<string, unknown>;
  /** Who wrote this version: the version's `by` (received Talks; my own carry none). */
  authorId?: string;
};

/**
 * Talk fields that are neither structure nor delivery fields but that the app shows. They travel
 * with the version, encrypted, as one value (spec §31.12 #17: to become graph records later).
 */
export const TALK_META_FIELDS = [
  'tags', 'ipfsAttachments', 'authorName', 'authorLocation', 'authorEpub',
  'originalAuthorId', 'originalCreatedAt', 'originalAuthorLocation', 'supersedesTalkId',
] as const;

export function talkMetaOf(talk: any): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  for (const field of TALK_META_FIELDS) {
    const value = talk?.[field] ?? talk?.meta?.[field];
    if (value !== undefined && value !== null && !(Array.isArray(value) && !value.length)) meta[field] = value;
  }
  return Object.keys(meta).length ? meta : undefined;
}

export function deliveryFields(talk: any): GraphNode {
  const out: GraphNode = { title: String(talk?.title ?? ''), isAdult: !!talk?.isAdult };
  const meta = talkMetaOf(talk);
  if (meta) out.meta = JSON.stringify(meta);
  if (typeof talk?.expiresAt === 'number' && Number.isFinite(talk.expiresAt)) out.expiresAt = talk.expiresAt;
  if (typeof talk?.locationRadiusMiles === 'number' && Number.isFinite(talk.locationRadiusMiles)) out.locationRadiusMiles = talk.locationRadiusMiles;
  return out;
}

export function createTalkGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number; chain?: EventChainSigner } = {}) {
  const souls = graphSouls(options.prefix);
  const now = options.now ?? Date.now;
  const talksList = souls.index('mine-talks');

  /**
   * The author's own built-in values (a price range I ask for) are also my declaration for that
   * question: the chatbot compares other people's Talks asking it against them (spec §30.2).
   */
  async function declareBuiltIns(talk: any, eventId: string, when: number): Promise<void> {
    const structure = talkStructureOf(talk);
    const keys = questionKeysOf(structure, 'author');
    await Promise.all(structure.questions.map(async (question) => {
      const values = builtInValues(question.builtIn);
      if (values) await store.put(souls.index(`typed/${typedIndexKey(structure, question, keys.get(question.id)!, talk?.title)}`), { ...values, ev: link(souls.event(eventId)), when } as GraphNode);
    }));
  }

  /**
   * Write a version event of a Talk. The structure is stored first, so an event never points at a
   * missing `rev/`; the event, its indexes and the caller's state writes then go in one batch.
   * (Two batches in all: each costs one Radisk flush, ~250 ms.)
   */
  async function writeVersion(
    talk: any,
    when: number,
    previous: { talkId: string; versionId: string } | undefined,
    alongside: (eventId: string) => Array<Promise<unknown>>,
    reservedId?: string,
  ): Promise<string> {
    const { soulKey } = await writeTalkStructure(store, talk, { perspective: 'author', prefix: options.prefix, now: when });
    const eventId = reservedId ?? await ids.next(when);
    const event: GraphNode = {
      v: GRAPH_SCHEMA_VERSION,
      when,
      device: await ids.deviceId(),
      rev: link(souls.rev(soulKey)),
      ...deliveryFields(talk),
    };
    if (previous) {
      event.talk = link(souls.event(previous.talkId));
      event.re = link(souls.event(previous.versionId));
    }
    await Promise.all([putEvent(store, souls, eventId, event, options.chain), declareBuiltIns(talk, eventId, when), ...alongside(eventId)]);
    return eventId;
  }

  async function readAt(talkId: string, versionId: string, mine: GraphNode | null): Promise<GraphTalk | undefined> {
    const latest = await store.get(souls.event(versionId));
    const revSoul = linkSoul(latest?.rev);
    if (!latest || !revSoul) return undefined;
    const structure = await readTalkStructure(store, revSoul.slice(souls.rev('').length), options.prefix);
    if (!structure) return undefined;
    const first = versionId === talkId ? latest : await store.get(souls.event(talkId));
    const talk: GraphTalk = {
      ...structure,
      id: talkId,
      title: String(latest.title ?? ''),
      isAdult: latest.isAdult === true,
      createdAt: Number(first?.when ?? parseEventId(talkId)?.when ?? 0),
      versionId,
      updatedAt: Number(latest.when ?? 0),
      active: mine?.active !== false,
      isTemplate: mine?.isTemplate === true,
    };
    const by = personIdOf(options.prefix ?? '', linkSoul(latest.by));
    if (by) talk.authorId = by;
    if (typeof latest.meta === 'string') { try { talk.meta = JSON.parse(latest.meta); } catch { /* unreadable meta is left out */ } }
    if (typeof latest.expiresAt === 'number') talk.expiresAt = latest.expiresAt;
    if (typeof latest.locationRadiusMiles === 'number') talk.locationRadiusMiles = latest.locationRadiusMiles;
    return talk;
  }

  return {
    /**
     * I wrote a Talk. Returns its id (the id of this first event). `reservedId` is an id the app
     * took earlier from `ids.next` (`graph.newTalkId`), so the app's Talk is known by it from the
     * start; its time is the event's time.
     */
    async create(talk: any, state: { active?: boolean; isTemplate?: boolean } = {}, alongside: (talkId: string) => Array<Promise<unknown>> = () => [], reservedId?: string): Promise<string> {
      const reserved = reservedId ? parseEventId(reservedId) : undefined;
      if (reservedId && (!reserved || reserved.deviceId !== await ids.deviceId())) throw new Error(`not an id of this device: ${reservedId}`);
      const when = reserved?.when ?? now();
      return writeVersion(talk, when, undefined, (talkId) => [
        store.put(souls.mine(`talk/${talkId}`), { latest: link(souls.event(talkId)), active: state.active ?? true, isTemplate: !!state.isTemplate }),
        addToIndex(store, talksList, { key: talkId, target: souls.mine(`talk/${talkId}`), when }),
        ...alongside(talkId),
      ], reservedId);
    },

    /**
     * I edited a Talk (D14): a new event with a new time, linked to the Talk and the version
     * before. Every edit, even of the title only, is a new version that peers are sent again.
     */
    async edit(talkId: string, talk: any, alongside: Array<Promise<unknown>> = []): Promise<string> {
      const mine = await store.get(souls.mine(`talk/${talkId}`));
      const previousSoul = linkSoul(mine?.latest);
      if (!previousSoul) throw new Error(`no Talk ${talkId} on this device`);
      return writeVersion(talk, now(), { talkId, versionId: previousSoul.slice(souls.event('').length) }, (versionId) => [
        store.put(souls.mine(`talk/${talkId}`), { latest: link(souls.event(versionId)) }),
        ...alongside,
      ]);
    },

    /**
     * I deleted a Talk (owner decision 2026-11-03): a new event, shared with everyone the Talk was
     * sent to, so their copies go too. The Talk leaves my list; its events stay (REQ-GRAPH-01) until
     * trimming removes old data. Returns the deletion event id, or undefined if it is not mine.
     */
    async remove(talkId: string, alongside: Array<Promise<unknown>> = []): Promise<string | undefined> {
      const mine = await store.get(souls.mine(`talk/${talkId}`));
      const latestSoul = linkSoul(mine?.latest);
      if (!latestSoul || mine?.deleted === true) return undefined;
      const when = now();
      const eventId = await ids.next(when);
      const event: GraphNode = {
        v: GRAPH_SCHEMA_VERSION, when, device: await ids.deviceId(),
        talk: link(souls.event(talkId)), re: link(latestSoul), deleted: true,
      };
      await Promise.all([
        putEvent(store, souls, eventId, event, options.chain),
        store.put(souls.mine(`talk/${talkId}`), { deleted: true, active: false, deletedBy: link(souls.event(eventId)) }),
        removeFromIndex(store, talksList, { key: talkId, when: parseEventId(talkId)?.when ?? when }),
        ...alongside,
      ]);
      return eventId;
    },

    async setState(talkId: string, state: { active?: boolean; isTemplate?: boolean }): Promise<void> {
      const value: GraphNode = {};
      if (state.active !== undefined) value.active = state.active;
      if (state.isTemplate !== undefined) value.isTemplate = state.isTemplate;
      await store.put(souls.mine(`talk/${talkId}`), value);
    },

    /** A Talk in its latest version, or undefined when it or its structure is not stored. */
    async read(talkId: string): Promise<GraphTalk | undefined> {
      const mine = await store.get(souls.mine(`talk/${talkId}`));
      if (mine?.deleted === true) return undefined;
      const latestSoul = linkSoul(mine?.latest) || souls.event(talkId);
      return readAt(talkId, latestSoul.slice(souls.event('').length), mine);
    },

    /** A Talk as one version wrote it (a received Talk, or an older version of mine). */
    async readVersion(talkId: string, versionId: string): Promise<GraphTalk | undefined> {
      return readAt(talkId, versionId, await store.get(souls.mine(`talk/${talkId}`)));
    },

    /** The versions of a Talk, newest first, by following `re` from the latest. */
    async history(talkId: string): Promise<string[]> {
      const mine = await store.get(souls.mine(`talk/${talkId}`));
      const out: string[] = [];
      let soul = linkSoul(mine?.latest) || souls.event(talkId);
      const seen = new Set<string>();
      while (soul && !seen.has(soul)) {
        seen.add(soul);
        out.push(soul.slice(souls.event('').length));
        const event = await store.get(soul);
        soul = linkSoul(event?.re) || '';
      }
      return out;
    },

    /** My Talk ids, newest first; `months` limits how many monthly buckets are read. */
    async list(options: { months?: number } = {}): Promise<string[]> {
      const entries = await readIndex(store, talksList, options.months ? { limitBuckets: options.months } : {});
      return entries.map((entry) => entry.key);
    },
  };
}
