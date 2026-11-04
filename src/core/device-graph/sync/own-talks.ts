/**
 * My Talks in the device graph (OPEN-106 step 2e, spec §31.10). A Talk the app creates takes its
 * id from the graph (`graph.newTalkId`), so the app and the graph know it by one id: saving it
 * writes the graph Talk under that id, and an edit is a new version of it.
 *
 * A Talk I send that the app knows by another id — a copy of someone's Talk, a liked starter tag —
 * is my own new graph Talk, copied from that id:
 *
 *   mine/talk/<talkId>   { …, source: <the app id it was copied from> }
 *   ix/copy/<appId>      { talk: →ev/<talkId> }
 *
 * A Talk deleted (retracted) and then turned on again is a new graph Talk too: receivers keep the
 * deleted one deleted. Only the latest version's signature is kept (`mine/talk.sig`), so the app
 * rewriting an unchanged entry writes nothing.
 */
import { applyGrammarToTalk } from '../../../shared/grammar-filter';
import { portableSha256Hex } from '../../../shared/portable-sha256';
import type { DeviceGraph } from '../device-graph';
import { parseEventId } from '../event-id';
import { canonicalJson } from '../keys';
import { link, linkSoul, type NodeStore } from '../node-store';
import { graphSouls, talkStructureOf } from '../talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type OwnTalksStatus = { talks: number; versions: number; errors: number; lastError?: string; lastMs?: number; maxMs?: number };

export function createOwnTalks(options: { store: NodeStore; graph: DeviceGraph; log?: (message: string) => void }) {
  const { store, graph } = options;
  const souls = graphSouls(graph.prefix);
  const mineSoul = (talkId: string) => souls.mine(`talk/${talkId}`);
  const copySoul = (appId: string) => souls.index(`copy/${encodeURIComponent(appId)}`);
  const statusSoul = souls.index('own-talks');
  const eventPrefix = souls.event('');

  const signatureOf = (talk: any) => portableSha256Hex(canonicalJson({
    structure: talkStructureOf(talk), title: String(talk.title ?? ''), isAdult: talk.isAdult === true,
    expiresAt: talk.expiresAt ?? null, locationRadiusMiles: talk.locationRadiusMiles ?? null,
  }));

  async function isOwnId(appId: string): Promise<boolean> {
    const parts = parseEventId(appId);
    return !!parts && parts.deviceId === await graph.ids.deviceId();
  }

  /** The live (not deleted) graph Talk the app knows by this id, if any. */
  async function liveTalkId(appId: string): Promise<string | undefined> {
    if (await isOwnId(appId)) {
      const mine = await store.get(mineSoul(appId));
      if (mine && mine.deleted !== true) return appId;
    }
    const copy = await store.get(copySoul(appId));
    const talkId = (linkSoul(copy?.talk) || '').slice(eventPrefix.length);
    if (!talkId) return undefined;
    const mine = await store.get(mineSoul(talkId));
    return mine && mine.deleted !== true ? talkId : undefined;
  }

  let counts: Record<string, number | string> = {};
  let statusQueue: Promise<void> = Promise.resolve();
  function count(changes: Record<string, number | string>): void {
    for (const [key, value] of Object.entries(changes)) counts[key] = typeof value === 'number' && key !== 'lastMs' && key !== 'maxMs' ? Number(counts[key] ?? 0) + value : value;
    statusQueue = statusQueue.then(async () => {
      if (!Object.keys(counts).length) return;
      const pending = counts;
      counts = {};
      const current = (await store.get(statusSoul)) || {};
      const next: Record<string, number | string> = {};
      for (const [key, value] of Object.entries(pending)) {
        next[key] = typeof value === 'number' && key !== 'lastMs' && key !== 'maxMs' ? Number(current[key] ?? 0) + value : value;
      }
      if (typeof next.maxMs === 'number') next.maxMs = Math.max(next.maxMs, Number(current.maxMs ?? 0));
      await store.put(statusSoul, next);
    }).catch(() => undefined);
  }

  async function ensureNow(entry: any): Promise<string | undefined> {
    const appId = String(entry?.talkId ?? '');
    if (!appId || !entry?.fullTalk || !Array.isArray(entry.fullTalk.questions)) return undefined;
    const started = Date.now();
    // The grammar filter corrects on write (spec §31.3a): receivers ignore a Talk with errors.
    const full = applyGrammarToTalk(entry.fullTalk);
    const talk = {
      ...full, title: String(full.title ?? entry.title ?? ''),
      expiresAt: entry.expiresAt ?? full.expiresAt, locationRadiusMiles: entry.locationRadiusMiles ?? full.locationRadiusMiles,
    };
    const sig = signatureOf(talk);
    const active = !entry.disabled;
    let talkId = await liveTalkId(appId);
    if (talkId) {
      const mine = await store.get(mineSoul(talkId));
      if (mine?.sig === sig) {
        if ((mine.active !== false) !== active) await graph.talks.setState(talkId, { active });
        return talkId;
      }
      await graph.talks.edit(talkId, talk, [store.put(mineSoul(talkId), { sig, active })]);
      count({ versions: 1 });
    } else {
      const reserved = (await isOwnId(appId)) && !(await store.get(mineSoul(appId))) ? appId : undefined;
      talkId = await graph.talks.create(talk, { active }, (id) => [
        store.put(mineSoul(id), { sig, ...(id === appId ? {} : { source: appId }) }),
        ...(id === appId ? [] : [store.put(copySoul(appId), { talk: link(souls.event(id)) })]),
      ], reserved);
      count({ talks: 1 });
    }
    const ms = Date.now() - started;
    count({ lastMs: ms, maxMs: ms });
    return talkId;
  }

  // One write at a time per app id: the collection write and an offer can arrive together.
  const inFlight = new Map<string, Promise<unknown>>();
  function ensure(entry: any): Promise<string | undefined> {
    const key = String(entry?.talkId ?? '');
    const previous = inFlight.get(key) ?? Promise.resolve();
    const run = previous.then(() => ensureNow(entry), () => ensureNow(entry));
    const settled = run.catch((error) => {
      const message = (error as Error)?.message || String(error);
      options.log?.(`[own-talks] ${key}: ${message}`);
      count({ errors: 1, lastError: message.slice(0, 300) });
      return undefined;
    });
    inFlight.set(key, settled);
    void settled.then(() => { if (inFlight.get(key) === settled) inFlight.delete(key); });
    return settled;
  }

  return {
    /** My Talk (`myTalks`, role `created`) into the graph: created once, a version per edit. */
    ensure,

    /** The app saved `myTalks` entries: my own Talks go into the graph. Never throws. */
    async onUpsert(entries: Record<string, unknown>): Promise<void> {
      for (const entry of Object.values(entries) as any[]) if (entry?.role === 'created') await ensure(entry);
    },

    /** The live graph Talk of an app id (`myTalks` key), waiting for a write of it in flight. */
    async graphTalkId(appId: string): Promise<string | undefined> {
      await inFlight.get(appId);
      return liveTalkId(appId);
    },

    /** The app's id for my graph Talk: the id it was copied from, else its own. */
    async appTalkId(talkId: string): Promise<string> {
      const mine = await store.get(mineSoul(talkId));
      return typeof mine?.source === 'string' && mine.source ? mine.source : talkId;
    },

    async status(): Promise<OwnTalksStatus> {
      await statusQueue;
      const node = (await store.get(statusSoul)) || {};
      const status: OwnTalksStatus = { talks: Number(node.talks ?? 0), versions: Number(node.versions ?? 0), errors: Number(node.errors ?? 0) };
      if (typeof node.lastError === 'string') status.lastError = node.lastError;
      if (typeof node.lastMs === 'number') status.lastMs = node.lastMs;
      if (typeof node.maxMs === 'number') status.maxMs = node.maxMs;
      return status;
    },

    /** Wait for writes in flight (tests, and a host shutting down). */
    async idle(): Promise<void> {
      await Promise.all(inFlight.values());
      await statusQueue;
    },
  };
}

export type OwnTalks = ReturnType<typeof createOwnTalks>;
