/**
 * My Talks' bodies come from the device graph (OPEN-106 step 2e iv, spec §31.10). The app keeps
 * a `myTalks` entry per Talk with the whole Talk in `fullTalk`; once a Talk I created is written
 * into the graph, its entry stops holding the body twice:
 *
 *   local/collections/myTalks/<appId>  { …entry, graphTalk: <talkId>, graphVersion: <versionId>,
 *                                        fullTalkRest: {…}, fullTalkDrop: [...] }
 *
 * The body is read back from that exact version (an immutable event, so a later edit or deletion
 * of the Talk does not change it). Only the top-level fields that come back identical are left
 * out: whatever the graph does not keep, or keeps differently (the app's own counters, a field
 * the structure normalises), stays in `fullTalkRest`, and fields the graph adds that the app's
 * Talk did not have are listed in `fullTalkDrop`. So reading an entry back gives the app exactly
 * the Talk it saved.
 *
 * The app's write goes first and whole; the body is taken out afterwards, and only if no newer
 * write of that entry was made meanwhile.
 */
import type { CollectionStore } from '../../collections';
import type { DeviceGraph } from '../device-graph';
import { canonicalJson } from '../keys';
import { appTalkOf } from './graph-host';
import type { OwnTalks } from './own-talks';

/* eslint-disable @typescript-eslint/no-explicit-any */

const COLLECTION = 'myTalks';
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export type MyTalksBodiesStatus = { stripped: number; kept: number; unreadable: number };

export function createMyTalksBodies(options: { collections: CollectionStore; graph: DeviceGraph; ownTalks: OwnTalks; log?: (message: string) => void }) {
  const { collections, graph, ownTalks } = options;
  // Bumped on every app write of an entry: a body is taken out only if none came after.
  const generation = new Map<string, number>();
  const pending = new Set<Promise<unknown>>();
  const counts: MyTalksBodiesStatus = { stripped: 0, kept: 0, unreadable: 0 };

  async function bodyOf(talkId: string, versionId: string): Promise<Record<string, unknown> | undefined> {
    const talk = await graph.talks.readVersion(talkId, versionId);
    return talk ? appTalkOf(talk as any) : undefined;
  }

  async function rebuild(key: string, entry: any): Promise<any> {
    if (!entry || entry.fullTalk || typeof entry.graphTalk !== 'string' || typeof entry.graphVersion !== 'string') return entry;
    const { graphTalk, graphVersion, fullTalkRest, fullTalkDrop, ...rest } = entry;
    const base = await bodyOf(graphTalk, graphVersion).catch(() => undefined);
    if (!base) {
      counts.unreadable += 1;
      options.log?.(`[my-talks] ${key}: graph version ${graphVersion} is unreadable`);
      return { ...rest, ...(fullTalkRest ? { fullTalk: fullTalkRest } : {}) };
    }
    for (const field of Array.isArray(fullTalkDrop) ? fullTalkDrop : []) delete base[field];
    return { ...rest, fullTalk: { ...base, ...(fullTalkRest ?? {}) } };
  }

  /** The entry without the fields of its body the graph gives back identical; undefined if none. */
  async function strip(entry: any, talkId: string): Promise<any> {
    const latest = await graph.talks.read(talkId);
    if (!latest) return undefined;
    const base = await bodyOf(talkId, latest.versionId);
    if (!base) return undefined;
    const saved = JSON.parse(JSON.stringify(entry.fullTalk));
    const fullTalkRest: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(saved)) if (!(field in base) || !same(base[field], value)) fullTalkRest[field] = value;
    const fullTalkDrop = Object.keys(base).filter((field) => !(field in saved));
    const kept = Object.keys(fullTalkRest).length;
    if (kept === Object.keys(saved).length) return undefined; // nothing would be saved
    const { fullTalk: _body, ...rest } = entry;
    return { ...rest, graphTalk: talkId, graphVersion: latest.versionId, ...(kept ? { fullTalkRest } : {}), ...(fullTalkDrop.length ? { fullTalkDrop } : {}) };
  }

  async function settle(key: string, entry: any, at: number): Promise<void> {
    const talkId = await ownTalks.ensure(entry);
    if (!talkId || generation.get(key) !== at) return;
    const stripped = await strip(entry, talkId);
    if (!stripped) { counts.kept += 1; return; }
    // Checked and written in one turn: an app write issued after this one wins (written later).
    if (generation.get(key) !== at) return;
    await collections.upsert(COLLECTION, { [key]: stripped });
    counts.stripped += 1;
  }

  function track(work: Promise<unknown>): void {
    const settled = work.catch((error) => options.log?.(`[my-talks] ${(error as Error)?.message || error}`));
    pending.add(settled);
    void settled.then(() => pending.delete(settled));
  }

  return {
    /** The app wrote `myTalks` entries: stored whole now, my created Talks' bodies taken out after. */
    async upsert(entries: Record<string, unknown>): Promise<number> {
      const at = new Map<string, number>();
      for (const key of Object.keys(entries)) {
        const next = (generation.get(key) ?? 0) + 1;
        generation.set(key, next);
        at.set(key, next);
      }
      const written = await collections.upsert(COLLECTION, entries);
      for (const [key, entry] of Object.entries(entries) as Array<[string, any]>) {
        if (entry?.role !== 'created' || !entry.fullTalk || !Array.isArray(entry.fullTalk.questions)) continue;
        track(settle(key, entry, at.get(key)!));
      }
      return written;
    },

    /** The app removed entries: a body taken out later must not bring one back. */
    async remove(keys: string[]): Promise<number> {
      for (const key of keys) generation.set(key, (generation.get(key) ?? 0) + 1);
      return collections.remove(COLLECTION, keys);
    },

    /** Every entry, bodies read back from the graph. */
    async all(): Promise<Record<string, unknown>> {
      const stored = await collections.all(COLLECTION);
      const out: Record<string, unknown> = {};
      await Promise.all(Object.entries(stored).map(async ([key, entry]) => { out[key] = await rebuild(key, entry); }));
      return out;
    },

    async get(key: string): Promise<unknown> {
      return rebuild(key, await collections.get(COLLECTION, key));
    },

    status(): MyTalksBodiesStatus {
      return { ...counts };
    },

    /** Wait for bodies being taken out (tests, and a host shutting down). */
    async idle(): Promise<void> {
      while (pending.size) await Promise.all([...pending]);
      await ownTalks.idle();
    },
  };
}

export type MyTalksBodies = ReturnType<typeof createMyTalksBodies>;
