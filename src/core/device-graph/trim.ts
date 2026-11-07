/**
 * Trimming old history (spec §31.13 REQ-GRAPH-47, OPEN-109 slice 2): when the store fills past
 * 90% of its limit (REQ-GRAPH-36), whole days are removed, oldest first, until usage drops under
 * 80%. A removed day loses its events (every field nulled — Gun has no delete), their day-index
 * entries, their gps sidecars, the content no remaining event or index points to, and the index
 * entries that pointed only to them. A signed checkpoint (REQ-GRAPH-46, chain.ts) is written
 * BEFORE anything is removed, so the trimmed prefix of my chain stays summarized by a signature
 * and `verifyChain` still passes over what remains.
 *
 * Never removed (the KEEP sets, built before anything is touched):
 *   - the last `keepDays` days (default 30);
 *   - an active Talk's first event and its latest version (`mine/talk/<id>` with active ≠ false);
 *   - every event a still-live chatbot memory points to: `ix/ctx/*`, `ix/whenever/*`, `ix/typed/*`
 *     `ev` links (and the content those events point to);
 *   - every event an unacknowledged pair-log entry names (a peer in `sync/owed` whose ack in
 *     `ix/ack/<peer>` is behind `sync/out/<peer>`);
 *   - Preferences events (`pref`): they are the replay record of the Whenever/ctx state;
 *   - the `talk` target of a kept event, one hop, so a kept answer's Talk still reads.
 * `cp/`, `ix/cp`, `ix/head`, pair-log blocks/heads/state, `person/`, `contact/` and settings are
 * never touched.
 *
 * Enumeration: a NodeStore reads by exact soul only, so two scans need a soul listing. With
 * `options.allSouls` given (the memory store's `souls()`, or the host listing Gun's graph keys)
 * the chatbot memories and the pair log are read exactly. Without it: chatbot-kept events are
 * found by the `ix/me` walk instead, and ANY peer with unacknowledged log entries makes every
 * event kept (safe, but nothing trims) — a host that cannot list souls must pass one that can.
 */
import { answerIndexClears, theirAnswerClears, theirQuestionsSoul } from './answers';
import { answerExtrasSoul, answerQuestionsSoul, rebuildIndexes } from './events';
import { chainHeadSoul, checkpointIndexSoul, writeCheckpoint, type ChainCheckpoint, type EventChainSigner } from './chain';
import { bucketOf, readIndex, removeFromIndex } from './index-buckets';
import { isNearbyEventShape } from './nearby-events';
import { parseEventId } from './event-id';
import { personIdOf } from './people-graph';
import { structureSouls } from './redact';
import { linkSoul, type GraphNode, type NodeStore } from './node-store';
import { DEVICE_GRAPH_LIMIT_BYTES, DEVICE_GRAPH_NEAR_FRACTION } from './storage-budget';
import type { graphSouls } from './talk-structure';

type Souls = ReturnType<typeof graphSouls>;

export const TRIM_KEEP_DAYS = 30;
/** Trimmed down to here (from DEVICE_GRAPH_NEAR_FRACTION), so the next trim is not due at once. */
export const TRIM_TARGET_FRACTION = 0.8;
const DAY_MS = 86_400_000;

export type TrimOptions = {
  /** Fresh usage reading, called before the run and again between days (never cached here). */
  usage: () => Promise<number | undefined>;
  limitBytes?: number;
  now?: () => number;
  keepDays?: number;
  /** Every soul in the store, when the host can list them (see the header note). */
  allSouls?: () => Promise<string[]>;
};

export type TrimResult = {
  /** The checkpoint written before anything was removed (absent when none was needed). */
  checkpoint?: ChainCheckpoint;
  /** The days (yyyy-mm-dd) that were removed, oldest first. */
  days: string[];
  /** How many events were trimmed. */
  events: number;
  /** How many content nodes were cleared. */
  content: number;
  /** True when usage ended under 80% of the limit (or never reached 90%). */
  done: boolean;
};

const noop: TrimResult = { days: [], events: 0, content: 0, done: true };

/** Every event id field a pair-log body names (offer/answer/deleted/deletedAnswer/declined). */
function collectLogRefs(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    if ((key === 'versionId' || key === 'eventId' || key === 'talkId' || key === 'answerEventId') && typeof field === 'string') into.add(field);
    else if (field && typeof field === 'object') collectLogRefs(field, into);
  }
}

/** The field erase of a node that still holds something (Gun merge: null deletes the field). */
const erase = (node: GraphNode | null): GraphNode | undefined => {
  if (!node) return undefined;
  const present = Object.keys(node).filter((key) => node[key] !== null && node[key] !== undefined);
  return present.length ? Object.fromEntries(present.map((key) => [key, null])) : undefined;
};

export async function trimHistory(
  store: NodeStore,
  souls: Souls,
  signer: EventChainSigner,
  options: TrimOptions,
): Promise<TrimResult> {
  const limit = options.limitBytes ?? DEVICE_GRAPH_LIMIT_BYTES;
  const now = options.now ?? Date.now;
  const keepDays = options.keepDays ?? TRIM_KEEP_DAYS;
  const prefix = souls.event('').slice(0, -'ev/'.length);
  const usage = () => options.usage().catch(() => undefined);
  const eventIdOf = (soul: string) => soul.slice(souls.event('').length);

  const first = await usage();
  if (typeof first !== 'number' || !Number.isFinite(first) || first < DEVICE_GRAPH_NEAR_FRACTION * limit) return noop;

  // Every event, through the day index (hour buckets), grouped by its day.
  const loaded: Array<{ id: string; day: string; bucket: string; event: GraphNode }> = [];
  for (const entry of await readIndex(store, souls.index('day'))) {
    const event = await store.get(entry.target);
    if (event) loaded.push({ id: entry.key, day: entry.bucket.slice(0, 10), bucket: entry.bucket, event });
  }

  // REQ-GRAPH-46: a signed checkpoint at the current head BEFORE anything is removed.
  let checkpoint: ChainCheckpoint | undefined;
  const [head, cpIndex] = await Promise.all([store.get(chainHeadSoul(souls)), store.get(checkpointIndexSoul(souls))]);
  if (head != null && Number.isSafeInteger(Number(head.seq)) && Number(head.seq) >= 0 && Number(cpIndex?.seq) !== Number(head.seq)) {
    checkpoint = await writeCheckpoint(store, souls, signer, {
      now,
      counts: { events: loaded.length, days: new Set(loaded.map((entry) => entry.day)).size },
    });
  }

  // ---- KEEP sets, built before anything is removed ------------------------------------------
  const keepEvents = new Set<string>();
  // Preferences events are the replay record of the Whenever/ctx state: they stay.
  for (const { id, event } of loaded) if (typeof event.pref === 'string') keepEvents.add(id);

  // (a) An active Talk's first event and its latest version.
  for (const entry of await readIndex(store, souls.index('mine-talks'))) {
    const mine = await store.get(souls.mine(`talk/${entry.key}`));
    if (!mine || mine.active === false || mine.deleted === true) continue;
    keepEvents.add(entry.key);
    const latest = linkSoul(mine.latest);
    if (latest) keepEvents.add(eventIdOf(latest));
  }

  const allSouls = options.allSouls ? await options.allSouls() : undefined;

  // (c) The chatbot's remembered answers: every `ev` link of ix/ctx/*, ix/whenever/*, ix/typed/*.
  if (allSouls) {
    const heads = [souls.index('ctx/'), souls.index('whenever/'), souls.index('typed/')];
    const nodes = await Promise.all(allSouls.filter((soul) => heads.some((head) => soul.startsWith(head))).map((soul) => store.get(soul)));
    for (const node of nodes) {
      const ev = linkSoul(node?.ev);
      if (ev?.startsWith(souls.event(''))) keepEvents.add(eventIdOf(ev));
    }
  } else {
    // Fallback without a soul listing: ix/me walks the same answer events (question → context → ev).
    for (const entry of await readIndex(store, souls.index('me'))) {
      const mine = await store.get(entry.target);
      for (const value of Object.values(mine || {})) {
        const ev = linkSoul(value);
        if (ev?.startsWith(souls.event(''))) keepEvents.add(eventIdOf(ev));
      }
    }
  }

  // (b) Events an unacknowledged pair-log entry names: a peer is owed entries its ack has not
  // covered (`ix/ack/<peer>`'s highest n below `sync/out/<peer>`'s n).
  const owed = await store.get(`${prefix}sync/owed`);
  let needBodies = false;
  for (const [peer, value] of Object.entries(owed || {})) {
    if (typeof value !== 'number') continue;
    const [ack, out] = await Promise.all([
      store.get(souls.index(`ack/${encodeURIComponent(peer)}`)),
      store.get(`${prefix}sync/out/${encodeURIComponent(peer)}`),
    ]);
    const acked = Object.keys(ack || {}).reduce((max, key) => (/^\d+$/.test(key) ? Math.max(max, Number(key)) : max), -1);
    if (Number(out?.n ?? -1) > acked) needBodies = true;
  }
  if (needBodies) {
    if (!allSouls) {
      // The log's souls cannot be named without the pair tags: keep everything, trim nothing.
      for (const { id } of loaded) keepEvents.add(id);
    } else {
      // My log blocks, whoever the pair is with; entries from a modern peer are SEA ciphertext,
      // and one unreadable entry in an owed range means its references are unknown: keep all.
      const blocks = allSouls.filter((soul) => /^g\/[0-9a-f]{32}\/p\/[0-9a-f]{32}\/log\/\d+$/.test(soul));
      for (const blockSoul of blocks) {
        const block = await store.get(blockSoul);
        for (const value of Object.values(block || {})) {
          if (typeof value !== 'string') continue;
          let entry: { body?: unknown } | undefined;
          try { entry = JSON.parse(value) as { body?: unknown }; } catch { entry = undefined; }
          if (!entry || typeof entry.body !== 'object' || !entry.body) {
            for (const { id } of loaded) keepEvents.add(id);
            break;
          }
          collectLogRefs(entry.body, keepEvents);
        }
      }
    }
  }

  // One hop of `talk` from kept events: a kept answer's Talk event stays readable.
  for (const { id, event } of loaded) {
    if (!keepEvents.has(id)) continue;
    const talk = linkSoul(event.talk);
    if (talk?.startsWith(souls.event(''))) keepEvents.add(eventIdOf(talk));
  }

  // Content kept: every rev/gave an event NOT removed points to. The removal set can only shrink
  // (the budget may be reached mid-run), so counting every candidate as removed is the safe side.
  const cutoff = bucketOf(now() - keepDays * DAY_MS, 'day');
  const removable = (entry: { id: string; day: string }) => entry.day < cutoff && !keepEvents.has(entry.id);
  const keepContent = new Set<string>();
  for (const entry of loaded) {
    if (removable(entry)) continue;
    for (const field of [entry.event.rev, entry.event.gave]) {
      const soul = linkSoul(field);
      if (soul) keepContent.add(soul);
    }
  }

  // ---- removal -------------------------------------------------------------------------------
  const removedIds = new Set<string>();
  let contentCleared = 0;
  const clearSouls = async (targets: Iterable<string>): Promise<void> => {
    const writes: Array<Promise<void>> = [];
    for (const soul of targets) {
      const clearing = erase(await store.get(soul));
      if (clearing) { contentCleared += 1; writes.push(store.put(soul, clearing)); }
    }
    await Promise.all(writes);
  };
  const applyClears = async (clears: Array<[string, GraphNode]>): Promise<void> => {
    await Promise.all(clears.map(([soul, node]) => store.put(soul, node)));
  };

  /** Clear one event: its fields, sidecars, gps point, solely-owned content and index footprint. */
  const clearEvent = async (id: string, event: GraphNode): Promise<void> => {
    removedIds.add(id);
    const eventSoul = souls.event(id);
    const when = Number(event.when) || 0;
    const talkSoul = linkSoul(event.talk);
    const talkId = talkSoul?.startsWith(souls.event('')) ? eventIdOf(talkSoul) : undefined;
    const withUser = personIdOf(prefix, linkSoul(event.with));

    // The content this event owns that no remaining event or index points to (redact.ts shape).
    const gave = linkSoul(event.gave);
    const content: string[] = [];
    if (gave && !keepContent.has(gave)) {
      content.push(gave);
      const sidecar = await store.get(event.by ? theirQuestionsSoul(souls, id) : answerQuestionsSoul(souls, id));
      for (const context of Object.keys(sidecar || {})) content.push(`${gave}/${context}`);
    }
    const rev = linkSoul(event.rev);
    if (rev && !keepContent.has(rev)) content.push(...await structureSouls(store, rev));
    await clearSouls(content);

    // The event itself, its private sidecars and its exact-location record.
    const clearing = erase(event);
    const writes: Array<Promise<unknown>> = [];
    if (clearing) writes.push(store.put(eventSoul, clearing));
    for (const sidecar of [answerQuestionsSoul(souls, id), answerExtrasSoul(souls, id), theirQuestionsSoul(souls, id)]) {
      const gone = erase(await store.get(sidecar));
      if (gone) writes.push(store.put(sidecar, gone));
    }
    const gps = erase(await store.get(`${prefix}gps/${id}`));
    if (gps) writes.push(store.put(`${prefix}gps/${id}`, gps));
    await Promise.all(writes);

    // The index footprint, per event shape (the events.ts rebuild switch, inverted). A Nearby
    // encounter or Place visit also leaves its cell listing, the same scope the rebuild indexes.
    const whereCell = linkSoul(event.where);
    if (isNearbyEventShape(event, prefix) && whereCell?.startsWith(`${prefix}cell/`)) {
      await removeFromIndex(store, souls.index(`cell/${whereCell.slice(`${prefix}cell/`.length)}/ev`), { key: id, when });
    }
    if (event.deleted === true) {
      if (event.by && talkId) {
        const deleted = await store.get(souls.index(`deleted/${talkId}`));
        if (linkSoul(deleted?.ev) === eventSoul) await store.put(souls.index(`deleted/${talkId}`), { ev: null });
      } else if (talkId) {
        const mine = await store.get(souls.mine(`talk/${talkId}`));
        if (linkSoul(mine?.deletedBy) === eventSoul) await store.put(souls.mine(`talk/${talkId}`), { deletedBy: null });
      }
    } else if (linkSoul(event.rev) && !event.by) {
      // A version of mine (an inactive Talk's — an active Talk's versions are kept): the state
      // node's links to it go, and with no latest left the Talk leaves the mine-talks list.
      const mineSoul = souls.mine(`talk/${talkId ?? id}`);
      const mine = await store.get(mineSoul);
      const nulls: GraphNode = {};
      for (const [key, value] of Object.entries(mine || {})) if (linkSoul(value) === eventSoul) nulls[key] = null;
      if (Object.keys(nulls).length) await store.put(mineSoul, nulls);
      if (linkSoul(mine?.latest) === eventSoul || (talkId === undefined && !linkSoul(mine?.latest))) {
        await removeFromIndex(store, souls.index('mine-talks'), { key: talkId ?? id, when: parseEventId(talkId ?? id)?.when ?? when });
      }
    } else if (gave && talkId && event.by) {
      const byUser = personIdOf(prefix, linkSoul(event.by));
      await applyClears(await theirAnswerClears(store, souls, talkId, byUser, id));
      await removeFromIndex(store, souls.index(`person/${encodeURIComponent(byUser)}/ev`), { key: id, when });
    } else if (gave && talkId) {
      await applyClears(await answerIndexClears(store, souls, id));
      await removeFromIndex(store, souls.index(`talk/${talkId}/ev`), { key: id, when });
      if (withUser) await removeFromIndex(store, souls.index(`person/${encodeURIComponent(withUser)}/ev`), { key: id, when });
    } else if (talkId && linkSoul(event.re) && withUser) {
      // An arrival: its received entry, and the incoming listing when no arrival of it remains.
      const receivedSoul = souls.index(`received/${talkId}`);
      const received = await store.get(receivedSoul);
      if (linkSoul(received?.[withUser]) === eventSoul) await store.put(receivedSoul, { [withUser]: null });
      const left = await store.get(receivedSoul);
      if (!Object.values(left || {}).some((value) => linkSoul(value))) {
        const at = await store.get(souls.index(`incoming-at/${talkId}`));
        await Promise.all(Object.keys(at || {}).filter((bucket) => at![bucket] === true)
          .map((bucket) => store.put(`${souls.index('incoming')}/${bucket}`, { [talkId]: null })));
        const gone = erase(at);
        if (gone) await store.put(souls.index(`incoming-at/${talkId}`), gone);
      }
      await removeFromIndex(store, souls.index(`person/${encodeURIComponent(withUser)}/ev`), { key: id, when });
    }
  };

  const removedDays: string[] = [];
  const candidateDays = [...new Set(loaded.filter((entry) => entry.day < cutoff).map((entry) => entry.day))].sort();
  let done = false;
  for (const day of candidateDays) {
    const used = await usage();
    if (typeof used === 'number' && Number.isFinite(used) && used < TRIM_TARGET_FRACTION * limit) { done = true; break; }
    const todays = loaded.filter((entry) => entry.day === day && !keepEvents.has(entry.id));
    if (!todays.length) continue;
    for (const { id, bucket, event } of todays) {
      await clearEvent(id, event);
      await store.put(`${souls.index('day')}/${bucket}`, { [id]: null });
    }
    removedDays.push(day);
    // Day buckets with nothing left leave the directory too.
    for (const bucket of new Set(todays.map((entry) => entry.bucket))) {
      const node = await store.get(`${souls.index('day')}/${bucket}`);
      if (!Object.values(node || {}).some((value) => linkSoul(value))) await store.put(souls.index('day'), { [bucket]: null });
    }
  }
  if (!done) {
    const used = await usage();
    done = typeof used === 'number' && Number.isFinite(used) && used < TRIM_TARGET_FRACTION * limit;
  }

  if (removedIds.size) {
    // The gps index's entries for removed events (one directory scan, day-bucketed).
    const gpsList = `${prefix}ix/gps`;
    const gpsDir = await store.get(gpsList);
    for (const value of Object.values(gpsDir || {})) {
      const bucketSoul = linkSoul(value);
      const node = bucketSoul ? await store.get(bucketSoul) : null;
      const nulls = Object.fromEntries(Object.entries(node || {})
        .filter(([id, entry]) => removedIds.has(id) && linkSoul(entry)).map(([id]) => [id, null]));
      if (Object.keys(nulls).length) await store.put(bucketSoul!, nulls);
    }
    // No index entry may keep pointing at a removed event (exact only with a soul listing).
    if (allSouls) {
      const removedSouls = new Set([...removedIds].map((id) => souls.event(id)));
      const heads = [souls.index(''), souls.mine('')];
      for (const soul of allSouls.filter((s) => heads.some((head) => s.startsWith(head)))) {
        const node = await store.get(soul);
        const nulls: GraphNode = {};
        for (const [key, value] of Object.entries(node || {})) {
          const target = linkSoul(value);
          if (target && removedSouls.has(target)) nulls[key] = null;
        }
        if (Object.keys(nulls).length) await store.put(soul, nulls);
      }
    }
    // The remaining indexes re-derive from what is left (REQ-GRAPH-02), so anything the footprint
    // clears missed for a SURVIVING event is put back.
    await rebuildIndexes(store, { prefix });
  }

  return {
    ...(checkpoint ? { checkpoint } : {}),
    days: removedDays,
    events: removedIds.size,
    content: contentCleared,
    done,
  };
}
