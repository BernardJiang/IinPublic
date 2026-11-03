/**
 * Writing events, and rebuilding every index from them (spec §31.2 REQ-GRAPH-02, §31.8).
 *
 * Each event is listed in `ix/day/<yyyy-mm-dd>` when it is written, so the events can be walked
 * in time order. The indexes are written after their event, and the app can die in between; so
 * at start-up `rebuildIndexes` puts back every index entry an event implies. Writes are merges, so
 * this is safe to repeat, and events are replayed oldest first, so "latest" entries end up latest.
 *
 * What an event is follows from its fields (REQ-GRAPH-20, no types):
 *   rev, no by          a version of my Talk      → mine/talk/<talkId>.latest, ix/mine-talks, ix/typed
 *   rev and by          a received Talk's version  (content; nothing to index)
 *   gave                my answer                  → ix/ctx, ix/q/<key>/mine, ix/me, ix/typed, ix/answered, ix/talk, ix/person
 *   talk, re, no gave   an arrival                 → ix/received, ix/incoming, ix/person
 */
import { addToIndex, readIndex } from './index-buckets';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { builtInValues, graphSouls, questionKeysOf, readTalkStructure } from './talk-structure';

type Souls = ReturnType<typeof graphSouls>;

/** Store an event and list it under its day. */
export async function putEvent(store: NodeStore, souls: Souls, eventId: string, event: GraphNode): Promise<void> {
  await Promise.all([
    store.put(souls.event(eventId), event),
    addToIndex(store, souls.index('day'), { key: eventId, target: souls.event(eventId), when: Number(event.when) }, 'day'),
  ]);
}

/**
 * The private sidecar of an answer event: which question each situation belongs to, so the Me tab
 * index can be rebuilt. It never leaves the device (question keys are guessable hashes, REQ-GRAPH-33).
 */
export const answerQuestionsSoul = (souls: Souls, eventId: string) => `${souls.event(eventId)}/q`;

export async function rebuildIndexes(store: NodeStore, options: { prefix?: string; fromDay?: string } = {}): Promise<{ events: number; repaired: number }> {
  const souls = graphSouls(options.prefix);
  const prefix = options.prefix ?? 'local/';
  const idOf = (soul: string | undefined) => (soul || '').slice(souls.event('').length);
  const entries = await readIndex(store, souls.index('day'), options.fromDay ? { from: options.fromDay } : {});
  const loaded: Array<{ id: string; event: GraphNode }> = [];
  for (const entry of entries) {
    const event = await store.get(entry.target);
    if (event) loaded.push({ id: entry.key, event });
  }
  loaded.sort((a, b) => (Number(a.event.when) - Number(b.event.when)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The replay computes the final value of every index node first, then writes only what differs,
  // so a second run writes nothing.
  const desired = new Map<string, GraphNode>();
  const listed: Array<{ listSoul: string; key: string; target: string; when: number; size: 'month' | 'day' }> = [];
  const ensure = async (soul: string, value: GraphNode) => { desired.set(soul, { ...(desired.get(soul) ?? {}), ...value }); };
  const ensureListed = async (listSoul: string, key: string, target: string, when: number, size: 'month' | 'day' = 'month') => {
    listed.push({ listSoul, key, target, when, size });
  };

  for (const { id, event } of loaded) {
    const when = Number(event.when);
    const talkSoul = linkSoul(event.talk);
    const withPub = (linkSoul(event.with) || '').slice(`${prefix}person/`.length);
    if (linkSoul(event.rev) && !event.by) {
      const talkId = talkSoul ? idOf(talkSoul) : id;
      await ensure(souls.mine(`talk/${talkId}`), { latest: link(souls.event(id)) });
      const structure = await readTalkStructure(store, linkSoul(event.rev)!.slice(souls.rev('').length), options.prefix);
      if (structure) {
        const keys = questionKeysOf(structure, 'author');
        for (const question of structure.questions) {
          const values = builtInValues(question.builtIn);
          if (values) await ensure(souls.index(`typed/${keys.get(question.id)!}`), { ...values, ev: link(souls.event(id)), when } as GraphNode);
        }
      }
      if (!talkSoul) await ensureListed(souls.index('mine-talks'), talkId, souls.mine(`talk/${talkId}`), when);
    } else if (linkSoul(event.gave) && talkSoul) {
      const talkId = idOf(talkSoul);
      const questions = await store.get(answerQuestionsSoul(souls, id));
      for (const [context, questionKey] of Object.entries(questions || {})) {
        if (typeof questionKey !== 'string') continue;
        await ensure(souls.index(`ctx/${context}`), { entry: link(`${linkSoul(event.gave)}/${context}`), mode: String(event.mode ?? ''), ev: link(souls.event(id)), when });
        await ensure(souls.index(`q/${questionKey}/mine`), { [context]: link(souls.event(id)) });
        await ensureListed(souls.index('me'), questionKey, souls.index(`q/${questionKey}/mine`), when);
        const entry = await store.get(`${linkSoul(event.gave)}/${context}`);
        if (typeof entry?.kind === 'string') await ensure(souls.index(`typed/${questionKey}`), { ...entry, ev: link(souls.event(id)), when });
      }
      await ensure(souls.index(`answered/${talkId}`), { ev: link(souls.event(id)), when });
      await ensureListed(souls.index(`talk/${talkId}/ev`), id, souls.event(id), when);
      if (withPub) await ensureListed(souls.index(`person/${withPub}/ev`), id, souls.event(id), when);
    } else if (talkSoul && linkSoul(event.re) && withPub) {
      const talkId = idOf(talkSoul);
      await ensure(souls.index(`received/${talkId}`), { [withPub]: link(souls.event(id)) });
      await ensureListed(souls.index('incoming'), talkId, souls.index(`received/${talkId}`), when);
      await ensureListed(souls.index(`person/${withPub}/ev`), id, souls.event(id), when);
    }
  }
  let repaired = 0;
  for (const [soul, value] of desired) {
    const current = await store.get(soul);
    const differs = Object.fromEntries(Object.entries(value).filter(([k, v]) => JSON.stringify(current?.[k]) !== JSON.stringify(v)));
    if (!Object.keys(differs).length) continue;
    await store.put(soul, differs);
    repaired += 1;
  }
  for (const entry of listed) {
    const bucket = new Date(entry.when).toISOString().slice(0, entry.size === 'day' ? 10 : 7);
    const [node, directory] = await Promise.all([store.get(`${entry.listSoul}/${bucket}`), store.get(entry.listSoul)]);
    if (linkSoul(node?.[entry.key]) === entry.target && linkSoul(directory?.[bucket])) continue;
    await addToIndex(store, entry.listSoul, entry, entry.size);
    repaired += 1;
  }
  return { events: loaded.length, repaired };
}
