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
 *   deleted, no by      I deleted my Talk (re → a version) or my answer (re → an answer event)
 *   gave and by         someone's answer to my Talk → ix/theirs (keyed buckets), ix/q/<key>/theirs, ix/talk, ix/person
 *   deleted and by      the author deleted a Talk I received   → ix/deleted, off ix/incoming;
 *                       or (re → their answer) someone deleted their answer → off ix/theirs …
 *   conv and text       a chat message (OPEN-110): by → me when I sent it, with → the other
 *                       person                            → ix/conv/<convId>, ix/convs,
 *                       and (received only) the ix/conv-seen/<convId> dedupe marker
 * Independently of the other shapes, a Nearby encounter or a Place visit (the events
 * nearby-events.ts writes) is also listed under ix/cell/<region>/ev by its `where` cell,
 * day-bucketed (§31.8). Rebuild mirrors write-time: Talk/answer events never write ix/cell,
 * so the rebuild does not add it for them either.
 */
import { keyBucket, keyedBucketSoul } from './keyed-buckets';
import { isNearbyEventShape } from './nearby-events';
import { answerIndexClears, theirAnswerClears, theirQuestionsSoul } from './answers';
import { addToIndex, bucketOf, readIndex, type BucketSize } from './index-buckets';
import { personIdOf } from './people-graph';
import { chainAndPut, verifyChain, type ChainVerification, type EventChainSigner } from './chain';
import { link, linkSoul, type GraphNode, type NodeStore } from './node-store';
import { builtInValues, graphSouls, questionKeysOf, readTalkStructure, typedIndexKey } from './talk-structure';

type Souls = ReturnType<typeof graphSouls>;

/** Store an event and list it under its day. With `chain` set, chain it first (REQ-GRAPH-40). */
export async function putEvent(store: NodeStore, souls: Souls, eventId: string, event: GraphNode, chain?: EventChainSigner, opts?: { ownBy?: string }): Promise<void> {
  const put = async (chained: GraphNode) => {
    await Promise.all([
      store.put(souls.event(eventId), chained),
      addToIndex(store, souls.index('day'), { key: eventId, target: souls.event(eventId), when: Number(chained.when) }, 'hour'),
    ]);
  };
  if (!chain) return put(event);
  await chainAndPut(store, souls, chain, event, put, opts);
}

/**
 * The private sidecar of an answer event: which question each situation belongs to, so the Me tab
 * index can be rebuilt. It never leaves the device (question keys are guessable hashes, REQ-GRAPH-33).
 */
export const answerQuestionsSoul = (souls: Souls, eventId: string) => `${souls.event(eventId)}/q`;

/**
 * The other private sidecar of my answer event: how the chatbot may reuse each situation's answer
 * and, for a built-in value, where it is my declaration. `{ <context>: '{"reuse":"once","typed":"<key>"}' }`,
 * situations reused as usual (`auto`, no declaration) left out. Never sent either.
 */
export const answerExtrasSoul = (souls: Souls, eventId: string) => `${souls.event(eventId)}/x`;

export type AnswerExtras = { reuse?: 'once' | 'whenever'; typed?: string };

export function parseAnswerExtras(raw: unknown): AnswerExtras {
  if (typeof raw !== 'string') return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}

/**
 * Rebuild every index from the stored events. With `options.chain` set (REQ-GRAPH-41 "verified at
 * start"), the events already loaded for the replay are also walked as my chain and the result is
 * reported as `chain`; a break is REPORTED, never repaired — stored events are never altered.
 * Chain verification needs the whole log, so `fromDay` and `chain` may not be combined. With a
 * checkpoint written (REQ-GRAPH-46), verification is checkpoint-scoped: events at or below the
 * checkpoint are summarized by its signature and only the post-checkpoint tail is re-verified.
 */
export async function rebuildIndexes(store: NodeStore, options: { prefix?: string; fromDay?: string;
  chain?: { verify(signature: string, message: string, pub: string): Promise<boolean>; pub: string; deviceId: string };
} = {}): Promise<{ events: number; repaired: number; chain?: ChainVerification }> {
  if (options.chain && options.fromDay) throw new Error('chain verification needs the full event log (no fromDay)');
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
  const listed: Array<{ listSoul: string; key: string; target: string; when: number; size: BucketSize }> = [];
  const ensure = async (soul: string, value: GraphNode) => { desired.set(soul, { ...(desired.get(soul) ?? {}), ...value }); };
  const ensureListed = async (listSoul: string, key: string, target: string, when: number, size: BucketSize = 'month') => {
    listed.push({ listSoul, key, target, when, size });
  };
  // Deletions are applied after the replay, so they win over the entries the replay put back.
  const deletions: Array<(view: Pick<NodeStore, 'get'>) => Promise<Array<[string, GraphNode]>>> = [];
  // Whenever offered lists, as the replay builds them: answer souls, first preference first.
  const whenever = new Map<string, string[]>();
  const linksOf = (node: GraphNode | null) => Array.from({ length: Number(node?.n || 0) }, (_, j) => linkSoul(node?.[String(j)])).filter((soul): soul is string => !!soul);

  for (const { id, event } of loaded) {
    const when = Number(event.when);
    if (typeof event.pref === 'string') {
      // A change made in the Preferences dialog (`answers.ts` `recordPreference`).
      if (event.pref === 'whenever' && typeof event.q === 'string') whenever.set(event.q, linksOf(event));
      else if (event.pref === 'ctx' && typeof event.context === 'string') {
        const at = souls.index(`ctx/${event.context}`);
        if (event.forget === true) await ensure(at, { entry: null, mode: null, reuse: null, ev: null, when: null });
        else if (typeof event.reuse === 'string') await ensure(at, { reuse: event.reuse });
        else if (linkSoul(event.entry)) await ensure(at, { entry: link(linkSoul(event.entry)!), when: Number(event.at ?? when) });
      }
      continue;
    }
    const talkSoul = linkSoul(event.talk);
    const withUser = personIdOf(prefix, linkSoul(event.with));
    // A Nearby encounter or Place visit (the nearby-events.ts shapes, carrying `where`) is
    // listed under its blurred cell (§31.8). Scoped to the shapes that write ix/cell at write
    // time: a rebuild must put back what the writers write, no more (REQ-GRAPH-02).
    const whereCell = linkSoul(event.where);
    if (isNearbyEventShape(event, prefix) && whereCell?.startsWith(`${prefix}cell/`)) {
      await ensureListed(souls.index(`cell/${whereCell.slice(`${prefix}cell/`.length)}/ev`), id, souls.event(id), when, 'day');
    }
    const withKey = encodeURIComponent(withUser);
    if (event.deleted === true) {
      const target = linkSoul(event.re);
      const targetEvent = target ? await store.get(target) : null;
      if (event.by && talkSoul && linkSoul(targetEvent?.gave) && target) {
        // Someone deleted their answer to my Talk.
        const talkId = idOf(talkSoul);
        const byUser = personIdOf(prefix, linkSoul(event.by));
        deletions.push((view) => theirAnswerClears(view, souls, talkId, byUser, idOf(target)));
      } else if (event.by && talkSoul) {
        const talkId = idOf(talkSoul);
        await ensure(souls.index(`deleted/${talkId}`), { ev: link(souls.event(id)) });
        deletions.push(async (view) => {
          const at = await view.get(souls.index(`incoming-at/${talkId}`));
          return Object.keys(at || {}).filter((b) => at![b] === true).map((b) => [`${souls.index('incoming')}/${b}`, { [talkId]: null }]);
        });
      } else if (linkSoul(targetEvent?.gave) && target) {
        deletions.push((view) => answerIndexClears(view, souls, idOf(target)));
      } else if (talkSoul) {
        const talkId = idOf(talkSoul);
        await ensure(souls.mine(`talk/${talkId}`), { deleted: true, active: false, deletedBy: link(souls.event(id)) });
        const created = Number((await store.get(talkSoul))?.when ?? when);
        deletions.push(async () => [[`${souls.index('mine-talks')}/${bucketOf(created, 'month')}`, { [talkId]: null }]]);
      }
    } else if (linkSoul(event.rev) && !event.by) {
      const talkId = talkSoul ? idOf(talkSoul) : id;
      await ensure(souls.mine(`talk/${talkId}`), { latest: link(souls.event(id)) });
      const structure = await readTalkStructure(store, linkSoul(event.rev)!.slice(souls.rev('').length), options.prefix);
      if (structure) {
        const keys = questionKeysOf(structure, 'author');
        for (const question of structure.questions) {
          const values = builtInValues(question.builtIn);
          if (values) await ensure(souls.index(`typed/${typedIndexKey(structure, question, keys.get(question.id)!, String(event.title ?? ''))}`), { ...values, ev: link(souls.event(id)), when } as GraphNode);
        }
      }
      if (!talkSoul) await ensureListed(souls.index('mine-talks'), talkId, souls.mine(`talk/${talkId}`), when);
    } else if (linkSoul(event.gave) && talkSoul && event.by) {
      // Someone else's answer to my Talk.
      const talkId = idOf(talkSoul);
      const byUser = personIdOf(prefix, linkSoul(event.by));
      const questions = await store.get(theirQuestionsSoul(souls, id));
      for (const questionKey of new Set(Object.values(questions || {}).filter((k): k is string => typeof k === 'string'))) {
        await ensureListed(souls.index(`q/${questionKey}/theirs`), id, souls.event(id), when);
      }
      const theirsSoul = souls.index(`theirs/${talkId}`);
      await ensure(keyedBucketSoul(theirsSoul, byUser), { [byUser]: link(souls.event(id)) });
      await ensure(theirsSoul, { [keyBucket(byUser)]: link(keyedBucketSoul(theirsSoul, byUser)) });
      await ensureListed(souls.index(`talk/${talkId}/ev`), id, souls.event(id), when);
      await ensureListed(souls.index(`person/${encodeURIComponent(byUser)}/ev`), id, souls.event(id), when);
    } else if (linkSoul(event.gave) && talkSoul) {
      const talkId = idOf(talkSoul);
      const [questions, extrasNode] = await Promise.all([store.get(answerQuestionsSoul(souls, id)), store.get(answerExtrasSoul(souls, id))]);
      for (const [context, questionKey] of Object.entries(questions || {})) {
        if (typeof questionKey !== 'string') continue;
        const extras = parseAnswerExtras(extrasNode?.[context]);
        // A Whenever offered answer is kept in `ix/whenever`, not as this situation's answer: its
        // choices go first in the question's list, as `answer` puts them.
        if (extras.reuse === 'whenever') {
          const chosenEntry = await store.get(`${linkSoul(event.gave)}/${context}`);
          const chosen = linkSoul(chosenEntry?.a) ? [linkSoul(chosenEntry!.a)!] : linksOf(chosenEntry);
          whenever.set(questionKey, [...new Set([...chosen, ...(whenever.get(questionKey) ?? []).filter((soul) => !chosen.includes(soul))])]);
        } else {
          await ensure(souls.index(`ctx/${context}`), { entry: link(`${linkSoul(event.gave)}/${context}`), mode: String(event.mode ?? ''), reuse: extras.reuse ?? 'auto', ev: link(souls.event(id)), when });
        }
        await ensure(souls.index(`q/${questionKey}/mine`), { [context]: link(souls.event(id)) });
        await ensureListed(souls.index('me'), questionKey, souls.index(`q/${questionKey}/mine`), when);
        const entry = await store.get(`${linkSoul(event.gave)}/${context}`);
        if (typeof entry?.kind === 'string' && extras.typed) await ensure(souls.index(`typed/${extras.typed}`), { ...entry, ev: link(souls.event(id)), when });
      }
      await ensure(souls.index(`answered/${talkId}`), { ev: link(souls.event(id)), when });
      await ensureListed(souls.index(`talk/${talkId}/ev`), id, souls.event(id), when);
      if (withUser) await ensureListed(souls.index(`person/${withKey}/ev`), id, souls.event(id), when);
    } else if (linkSoul(event.conv) && typeof event.text === 'string') {
      // A chat message (OPEN-110, REQ-GRAPH-49): `by` → me when I sent it, `with` → the other
      // person; `conv` links the conversation's state node (`mine/conv/<convId>`).
      const convSoul = linkSoul(event.conv)!;
      const convHead = souls.mine('conv/');
      const convId = convSoul.startsWith(convHead) ? convSoul.slice(convHead.length) : '';
      if (convId) {
        await ensureListed(souls.index(`conv/${convId}`), id, souls.event(id), when, 'day');
        await ensure(souls.index('convs'), { [convId]: when });
        // A received message names the sender's event in `re`: its dedupe marker rebuilds too.
        const seen = linkSoul(event.re);
        if (!event.by && seen?.startsWith(souls.event(''))) {
          await ensure(souls.index(`conv-seen/${encodeURIComponent(convId)}`), { [seen.slice(souls.event('').length)]: link(souls.event(id)) });
        }
      }
    } else if (talkSoul && linkSoul(event.re) && withUser) {
      const talkId = idOf(talkSoul);
      // As `receive`: an arrival after the author deleted the Talk lists nothing but the person.
      if (event.ignored !== 'deleted') {
        await ensure(souls.index(`received/${talkId}`), { [withUser]: link(souls.event(id)) });
        await ensureListed(souls.index('incoming'), talkId, souls.index(`received/${talkId}`), when, 'day');
        await ensure(souls.index(`incoming-at/${talkId}`), { [bucketOf(when, 'day')]: true });
      }
      await ensureListed(souls.index(`person/${withKey}/ev`), id, souls.event(id), when);
    }
  }
  for (const [questionKey, list] of whenever) {
    const soul = souls.index(`whenever/${questionKey}`);
    const old = await store.get(soul);
    const node: GraphNode = { n: list.length };
    for (const field of Object.keys(old || {})) if (/^\d+$/.test(field) && Number(field) >= list.length) node[field] = null;
    list.forEach((answer, j) => { node[String(j)] = link(answer); });
    await ensure(soul, node);
  }
  // Deletions see the replayed indexes (planned values over what is stored), and take their fields
  // out of the plan, so a second run plans nothing and writes nothing.
  const view: Pick<NodeStore, 'get'> = {
    get: async (soul) => {
      const stored = await store.get(soul);
      const planned = desired.get(soul);
      return stored || planned ? { ...(stored ?? {}), ...(planned ?? {}) } : null;
    },
  };
  const removed = new Set<string>();
  const nulls = new Map<string, GraphNode>();
  for (const deletion of deletions) {
    for (const [soul, value] of await deletion(view)) {
      const planned = desired.get(soul);
      for (const key of Object.keys(value)) {
        removed.add(`${soul}\u0000${key}`);
        if (planned) delete planned[key];
        nulls.set(soul, { ...(nulls.get(soul) ?? {}), [key]: null });
      }
    }
  }
  let repaired = 0;
  for (const [soul, value] of desired) {
    const current = await store.get(soul);
    // A planned null (a field taken out) is already done when the field is absent.
    const differs = Object.fromEntries(Object.entries(value).filter(([k, v]) => (v === null ? current?.[k] !== null && current?.[k] !== undefined : JSON.stringify(current?.[k]) !== JSON.stringify(v))));
    if (!Object.keys(differs).length) continue;
    await store.put(soul, differs);
    repaired += 1;
  }
  for (const [soul, value] of nulls) {
    const current = await store.get(soul);
    const present = Object.fromEntries(Object.keys(value).filter((k) => current?.[k] !== null && current?.[k] !== undefined).map((k) => [k, null]));
    if (!Object.keys(present).length) continue;
    await store.put(soul, present);
    repaired += 1;
  }
  for (const entry of listed) {
    const bucketSoul = `${entry.listSoul}/${bucketOf(entry.when, entry.size)}`;
    if (removed.has(`${bucketSoul}\u0000${entry.key}`)) continue;
    const bucket = bucketOf(entry.when, entry.size);
    const [node, directory] = await Promise.all([store.get(`${entry.listSoul}/${bucket}`), store.get(entry.listSoul)]);
    if (linkSoul(node?.[entry.key]) === entry.target && linkSoul(directory?.[bucket])) continue;
    await addToIndex(store, entry.listSoul, entry, entry.size);
    repaired += 1;
  }
  // The chain check reuses the loaded events (no second read) and never touches the store.
  const chain = options.chain
    ? await verifyChain(store, souls, { verify: options.chain.verify }, { pub: options.chain.pub, deviceId: options.chain.deviceId }, async () => loaded)
    : undefined;
  return { events: loaded.length, repaired, ...(chain ? { chain } : {}) };
}
