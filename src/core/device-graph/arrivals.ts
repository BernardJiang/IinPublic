/**
 * A Talk arriving from someone (spec §31.5, REQ-GRAPH-16, -21, -22). The receiver copies the
 * author's version event and structure into its own graph by the same keys, and writes its own
 * private arrival event with its own clock: who sent it, which version, over which link, where.
 *
 *   person/<userId>           { userId, pub?, firstSeen }               state (people-graph.ts)
 *   ev/<versionId>            the author's version event, copied          content-like, written once
 *   ev/<arrivalId>            { v, when, device, with: →person, talk, re: →the version, link?, where?, ignored? }
 *   ix/received/<talkId>      { <senderPub>: →ev/<arrivalId> }            latest arrival per sender
 *   ix/incoming               bucketed: talkId → ix/received/<talkId>
 *   ix/incoming-at/<talkId>   { <bucket>: true }  the incoming buckets that list it, for removal
 *   ix/deleted/<talkId>       { ev: →the author's deletion event }   the author deleted it
 *   ix/person/<userId>/ev        bucketed
 *
 * A repeat arrival writes one arrival event and no content. A Talk whose text the grammar filter
 * would change is ignored whole: its arrival is still written, with `ignored: 'grammar'`, and its
 * structure is not stored.
 */
import { putEvent } from './events';
import type { EventChainSigner } from './chain';
import type { StorageBudget } from './storage-budget';
import { personIdOf, personSoul, personWrites } from './people-graph';
import { talkGrammarErrors } from '../../shared/grammar-filter';
import { addToIndex, bucketOf, readIndex } from './index-buckets';
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
  /** The author's user ID (spec §31.6: people are keyed by user ID) and its public key. */
  authorId: string;
  authorPub?: string;
  /** The author's version event fields. */
  when: number;
  device: string;
  /** The Talk: structure plus title and delivery fields. */
  talk: any;
};

export function createArrivalGraph(store: NodeStore, ids: EventIds, options: { prefix?: string; now?: () => number; chain?: EventChainSigner; budget?: Pick<StorageBudget, 'acceptsIncoming'> } = {}) {
  const souls = graphSouls(options.prefix);
  const prefix = options.prefix ?? 'local/';
  const person = (userId: string) => personSoul(prefix, userId);
  const now = options.now ?? Date.now;
  const talks = createTalkGraph(store, ids, options);
  const v = GRAPH_SCHEMA_VERSION;

  return {
    /**
     * `importing`: a Talk from today's collections (spec §31.10). Old texts predate the filter and
     * are kept for the owner's history, so they are not checked.
     */
    async receive(incoming: IncomingTalk, from: { userId: string; pub?: string; link?: string; where?: string; importing?: boolean;
      /** The sender's log entry that carried this offer (`n`, hash, `when`), so an answer can name
       * it back (REQ-GRAPH-44). Stored flat (`entryN`/`entryHash`/`entryWhen`): a graph node's
       * values are scalars and links only. */
      entry?: { n: number; hash: string; when: number } }): Promise<{ arrivalId?: string; ignored?: 'grammar' | 'deleted' | 'storage-full' }> {
      // The store is full (1 GB): nothing someone sends is written, not even the arrival.
      if (options.budget && !(await options.budget.acceptsIncoming())) return { ignored: 'storage-full' };
      const when = now();
      // A Talk its author deleted stays deleted: a copy still travelling is recorded, not shown.
      const deleted = !!linkSoul((await store.get(souls.index(`deleted/${incoming.talkId}`)))?.ev);
      const ignored = deleted ? 'deleted' as const
        : !from.importing && talkGrammarErrors(incoming.talk).length ? 'grammar' as const : undefined;
      const [people, versionStored] = await Promise.all([
        personWrites(store, prefix, [{ userId: incoming.authorId, pub: incoming.authorPub }, { userId: from.userId, pub: from.pub }], when),
        store.get(souls.event(incoming.versionId)),
      ]);
      // People, the copied version and my arrival with its indexes: one batch after the structure.
      const batch: Array<Promise<unknown>> = people.map(([soul, node]) => store.put(soul, node));
      if (!versionStored) {
        const version: GraphNode = { v, when: incoming.when, device: incoming.device, by: link(person(incoming.authorId)), ...deliveryFields(incoming.talk) };
        if (!ignored) {
          const { soulKey } = await writeTalkStructure(store, incoming.talk, { perspective: 'responder', prefix: options.prefix, now: when });
          version.rev = link(souls.rev(soulKey));
        }
        if (incoming.versionId !== incoming.talkId) version.talk = link(souls.event(incoming.talkId));
        if (incoming.previousVersionId) version.re = link(souls.event(incoming.previousVersionId));
        batch.push(putEvent(store, souls, incoming.versionId, version, options.chain));
      }
      const arrivalId = await ids.next(when);
      const arrival: GraphNode = {
        v, when, device: await ids.deviceId(), with: link(person(from.userId)),
        talk: link(souls.event(incoming.talkId)), re: link(souls.event(incoming.versionId)),
      };
      if (from.link) arrival.link = from.link;
      if (from.entry) { arrival.entryN = from.entry.n; arrival.entryHash = from.entry.hash; arrival.entryWhen = from.entry.when; }
      if (from.importing) arrival.mode = 'import';
      if (from.where) arrival.where = link(`${prefix}cell/${from.where}`);
      if (ignored) arrival.ignored = ignored;
      await Promise.all([
        ...batch,
        putEvent(store, souls, arrivalId, arrival, options.chain),
        ...(deleted ? [] : [
          store.put(souls.index(`received/${incoming.talkId}`), { [from.userId]: link(souls.event(arrivalId)) }),
          addToIndex(store, souls.index('incoming'), { key: incoming.talkId, target: souls.index(`received/${incoming.talkId}`), when }, 'day'),
          store.put(souls.index(`incoming-at/${incoming.talkId}`), { [bucketOf(when, 'day')]: true }),
        ]),
        addToIndex(store, souls.index(`talk/${incoming.talkId}/ev`), { key: arrivalId, target: souls.event(arrivalId), when }),
        addToIndex(store, souls.index(`person/${encodeURIComponent(from.userId)}/ev`), { key: arrivalId, target: souls.event(arrivalId), when }),
      ]);
      return ignored ? { arrivalId, ignored } : { arrivalId };
    },

    /**
     * The author deleted a Talk I received (owner decision 2026-11-03). Their deletion event is
     * copied, like a version, and the Talk leaves my incoming list; arrivals after this are recorded
     * but not shown. My own answers to it stay mine (my history; deleting them is my choice).
     * Only the author may delete: a deletion from anyone else is refused.
     */
    async receiveDeletion(deletion: { talkId: string; eventId: string; authorId: string; when: number; device: string; versionId?: string }): Promise<boolean> {
      const first = await store.get(souls.event(deletion.talkId));
      const author = personIdOf(prefix, linkSoul(first?.by));
      if (author && author !== deletion.authorId) return false;
      const [people, at] = await Promise.all([
        personWrites(store, prefix, [{ userId: deletion.authorId }], now()),
        store.get(souls.index(`incoming-at/${deletion.talkId}`)),
      ]);
      const event: GraphNode = {
        v, when: deletion.when, device: deletion.device, by: link(person(deletion.authorId)),
        talk: link(souls.event(deletion.talkId)), deleted: true,
      };
      if (deletion.versionId) event.re = link(souls.event(deletion.versionId));
      await Promise.all([
        ...people.map(([soul, node]) => store.put(soul, node)),
        putEvent(store, souls, deletion.eventId, event, options.chain),
        store.put(souls.index(`deleted/${deletion.talkId}`), { ev: link(souls.event(deletion.eventId)) }),
        ...Object.keys(at || {}).filter((bucket) => at![bucket] === true).map((bucket) =>
          store.put(`${souls.index('incoming')}/${bucket}`, { [deletion.talkId]: null })),
      ]);
      return true;
    },

    /**
     * A received Talk in the newest version any sender delivered, with who sent it. Undefined when
     * every arrival was ignored or the structure is missing.
     */
    async read(talkId: string): Promise<(GraphTalk & { senders: string[]; latestArrival: string }) | undefined> {
      if (linkSoul((await store.get(souls.index(`deleted/${talkId}`)))?.ev)) return undefined;
      const received = await store.get(souls.index(`received/${talkId}`));
      let best: { versionId: string; versionWhen: number; arrivalId: string } | undefined;
      const senders: string[] = [];
      for (const [userId, value] of Object.entries(received || {})) {
        const arrivalSoul = linkSoul(value);
        const arrival = arrivalSoul ? await store.get(arrivalSoul) : null;
        if (!arrival || arrival.ignored) continue;
        senders.push(userId);
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

    /** Received Talk ids, newest arrival day first (`months`: only that many recent months). */
    async incoming(options: { months?: number } = {}): Promise<string[]> {
      const from = options.months ? bucketOf(now() - options.months * 31 * 86_400_000, 'day') : undefined;
      const entries = await readIndex(store, souls.index('incoming'), from ? { from } : {});
      return [...new Set(entries.map((e) => e.key))];
    },
  };
}
