/**
 * A Talk arriving from someone (spec §31.5, REQ-GRAPH-16, -21, -22). The receiver copies the
 * author's version event and structure into its own graph by the same keys, and writes its own
 * private arrival event with its own clock: who sent it, which version, over which link, where.
 *
 *   person/<pub>              { pub, firstSeen }                        state, written once
 *   ev/<versionId>            the author's version event, copied          content-like, written once
 *   ev/<arrivalId>            { v, when, device, with: →person, talk, re: →the version, link?, where?, ignored? }
 *   ix/received/<talkId>      { <senderPub>: →ev/<arrivalId> }            latest arrival per sender
 *   ix/incoming               bucketed: talkId → ix/received/<talkId>
 *   ix/person/<pub>/ev        bucketed
 *
 * A repeat arrival writes one arrival event and no content. A Talk whose text the grammar filter
 * would change is ignored whole: its arrival is still written, with `ignored: 'grammar'`, and its
 * structure is not stored.
 */
import { putEvent } from './events';
import { talkGrammarErrors } from '../../shared/grammar-filter';
import { addToIndex, readIndex } from './index-buckets';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { GRAPH_SCHEMA_VERSION, graphSouls, writeTalkStructure } from './talk-structure';
import { createTalkGraph, deliveryFields, type EventIds, type GraphTalk } from './talk-events';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type IncomingTalk = {
  /** The Talk's id: the author's first event. */
  talkId: string;
  /** The author's event for this version (= talkId for the first version). */
  versionId: string;
  /** The version before, for an edit. */
  previousVersionId?: string;
  authorPub: string;
  /** The author's version event fields. */
  when: number;
  device: string;
  /** The Talk: structure plus title and delivery fields. */
  talk: any;
};

export function createArrivalGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number } = {}) {
  const souls = graphSouls(options.prefix);
  const prefix = options.prefix ?? 'local/';
  const person = (pub: string) => `${prefix}person/${pub}`;
  const now = options.now ?? Date.now;
  const talks = createTalkGraph(store, ids, options);
  const v = GRAPH_SCHEMA_VERSION;

  return {
    /**
     * `importing`: a Talk from today's collections (spec §31.10). Old texts predate the filter and
     * are kept for the owner's history, so they are not checked.
     */
    async receive(incoming: IncomingTalk, from: { pub: string; link?: string; where?: string; importing?: boolean }): Promise<{ arrivalId: string; ignored?: 'grammar' }> {
      const when = now();
      const ignored = !from.importing && talkGrammarErrors(incoming.talk).length ? 'grammar' as const : undefined;
      const pubs = [...new Set([incoming.authorPub, from.pub])];
      const [known, versionStored] = await Promise.all([Promise.all(pubs.map((pub) => store.get(person(pub)))), store.get(souls.event(incoming.versionId))]);
      // People, the copied version and my arrival with its indexes: one batch after the structure.
      const batch: Array<Promise<unknown>> = pubs.filter((_, i) => !known[i]).map((pub) => store.put(person(pub), { pub, firstSeen: when }));
      if (!versionStored) {
        const version: GraphNode = { v, when: incoming.when, device: incoming.device, by: link(person(incoming.authorPub)), ...deliveryFields(incoming.talk) };
        if (!ignored) {
          const { soulKey } = await writeTalkStructure(store, incoming.talk, { perspective: 'responder', prefix: options.prefix, now: when });
          version.rev = link(souls.rev(soulKey));
        }
        if (incoming.versionId !== incoming.talkId) version.talk = link(souls.event(incoming.talkId));
        if (incoming.previousVersionId) version.re = link(souls.event(incoming.previousVersionId));
        batch.push(putEvent(store, souls, incoming.versionId, version));
      }
      const arrivalId = await ids.next(when);
      const arrival: GraphNode = {
        v, when, device: await ids.deviceId(), with: link(person(from.pub)),
        talk: link(souls.event(incoming.talkId)), re: link(souls.event(incoming.versionId)),
      };
      if (from.link) arrival.link = from.link;
      if (from.importing) arrival.mode = 'import';
      if (from.where) arrival.where = link(`${prefix}cell/${from.where}`);
      if (ignored) arrival.ignored = ignored;
      await Promise.all([
        ...batch,
        putEvent(store, souls, arrivalId, arrival),
        store.put(souls.index(`received/${incoming.talkId}`), { [from.pub]: link(souls.event(arrivalId)) }),
        addToIndex(store, souls.index('incoming'), { key: incoming.talkId, target: souls.index(`received/${incoming.talkId}`), when }),
        addToIndex(store, souls.index(`person/${from.pub}/ev`), { key: arrivalId, target: souls.event(arrivalId), when }),
      ]);
      return ignored ? { arrivalId, ignored } : { arrivalId };
    },

    /**
     * A received Talk in the newest version any sender delivered, with who sent it. Undefined when
     * every arrival was ignored or the structure is missing.
     */
    async read(talkId: string): Promise<(GraphTalk & { senders: string[]; latestArrival: string }) | undefined> {
      const received = await store.get(souls.index(`received/${talkId}`));
      let best: { versionId: string; versionWhen: number; arrivalId: string } | undefined;
      const senders: string[] = [];
      for (const [pub, value] of Object.entries(received || {})) {
        const arrivalSoul = linkSoul(value);
        const arrival = arrivalSoul ? await store.get(arrivalSoul) : null;
        if (!arrival || arrival.ignored) continue;
        senders.push(pub);
        const versionSoul = linkSoul(arrival.re);
        const version = versionSoul ? await store.get(versionSoul) : null;
        const versionWhen = Number(version?.when ?? 0);
        const arrivalId = arrivalSoul!.slice(souls.event('').length);
        // The newest version; for one version, its latest arrival (my own ids sort by time).
        if (versionSoul && (!best || versionWhen > best.versionWhen || (versionWhen === best.versionWhen && arrivalId > best.arrivalId))) {
          best = { versionId: versionSoul.slice(souls.event('').length), versionWhen, arrivalId };
        }
      }
      if (!best) return undefined;
      const talk = await talks.readVersion(talkId, best.versionId);
      return talk ? { ...talk, senders: senders.sort(), latestArrival: best.arrivalId } : undefined;
    },

    /** Received Talk ids: the latest month of arrivals first, newest Talk first within a month. */
    async incoming(options: { months?: number } = {}): Promise<string[]> {
      const entries = await readIndex(store, souls.index('incoming'), options.months ? { limitBuckets: options.months } : {});
      return [...new Set(entries.map((e) => e.key))];
    },
  };
}
