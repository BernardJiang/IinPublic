/**
 * Talks as events (spec §31.3, §31.5, D14, D16). A Talk's id is the id of the event that first
 * wrote it; every edit is a new event of the same Talk (`talk` → the first event, `re` → the
 * version before). The structure lives in `rev/<hash>`; the event carries only what is not
 * structure: title, delivery fields and when.
 *
 *   ev/<talkId>        { v, when, device, rev: →rev/…, title, isAdult, expiresAt?, locationRadiusMiles? }
 *   ev/<editId>        { …the same, talk: →ev/<talkId>, re: →ev/<previous> }
 *   mine/talk/<talkId> { latest: →ev/…, active, isTemplate }                       state
 *   ix/mine-talks      bucketed list of my Talks, by the Talk's first event time
 */
import { putEvent } from './events';
import { addToIndex, readIndex } from './index-buckets';
import { parseEventId } from './event-id';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { GRAPH_SCHEMA_VERSION, builtInValues, graphSouls, questionKeysOf, readTalkStructure, talkStructureOf, writeTalkStructure, type TalkStructure } from './talk-structure';

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
};

export function deliveryFields(talk: any): GraphNode {
  const out: GraphNode = { title: String(talk?.title ?? ''), isAdult: !!talk?.isAdult };
  if (typeof talk?.expiresAt === 'number' && Number.isFinite(talk.expiresAt)) out.expiresAt = talk.expiresAt;
  if (typeof talk?.locationRadiusMiles === 'number' && Number.isFinite(talk.locationRadiusMiles)) out.locationRadiusMiles = talk.locationRadiusMiles;
  return out;
}

export function createTalkGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number } = {}) {
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
      if (values) await store.put(souls.index(`typed/${keys.get(question.id)!}`), { ...values, ev: link(souls.event(eventId)), when } as GraphNode);
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
  ): Promise<string> {
    const { soulKey } = await writeTalkStructure(store, talk, { perspective: 'author', prefix: options.prefix, now: when });
    const eventId = await ids.next(when);
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
    await Promise.all([putEvent(store, souls, eventId, event), declareBuiltIns(talk, eventId, when), ...alongside(eventId)]);
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
    if (typeof latest.expiresAt === 'number') talk.expiresAt = latest.expiresAt;
    if (typeof latest.locationRadiusMiles === 'number') talk.locationRadiusMiles = latest.locationRadiusMiles;
    return talk;
  }

  return {
    /** I wrote a Talk. Returns its id (the id of this first event). */
    async create(talk: any, state: { active?: boolean; isTemplate?: boolean } = {}, alongside: (talkId: string) => Array<Promise<unknown>> = () => []): Promise<string> {
      const when = now();
      return writeVersion(talk, when, undefined, (talkId) => [
        store.put(souls.mine(`talk/${talkId}`), { latest: link(souls.event(talkId)), active: state.active ?? true, isTemplate: !!state.isTemplate }),
        addToIndex(store, talksList, { key: talkId, target: souls.mine(`talk/${talkId}`), when }),
        ...alongside(talkId),
      ]);
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

    async setState(talkId: string, state: { active?: boolean; isTemplate?: boolean }): Promise<void> {
      const value: GraphNode = {};
      if (state.active !== undefined) value.active = state.active;
      if (state.isTemplate !== undefined) value.isTemplate = state.isTemplate;
      await store.put(souls.mine(`talk/${talkId}`), value);
    },

    /** A Talk in its latest version, or undefined when it or its structure is not stored. */
    async read(talkId: string): Promise<GraphTalk | undefined> {
      const mine = await store.get(souls.mine(`talk/${talkId}`));
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
