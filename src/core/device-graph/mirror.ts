/**
 * Phase 4 of OPEN-106: write Talks and answers to both stores. The app keeps reading its
 * collections; every `myTalks` write is also written into the device graph, read back, and
 * compared. Off unless the host turns it on, and it never fails the app's write: errors and
 * mismatches are counted in `local/ix/mirror` for a debug read.
 *
 * Legacy ids (`qa_…`, CIDs) map to graph Talks through `ix/legacy/<oldTalkId>` (spec §31.10):
 *   { talk: →ev/<talkId>, title, structure: <rev key>, answers: <signature> }
 * so a repeated write of the same entry writes nothing, and an edit becomes a new version.
 *
 * A Talk I received and answered has no author event on this device yet (delivery still sends
 * JSON), so its author event id is derived from the old id and the Talk's time, on a device id
 * derived from the author: the same old record always maps to the same event (spec §31.10).
 */
import { portableSha256Hex } from '../../shared/portable-sha256';
import { applyGrammarToTalk } from '../../shared/grammar-filter';
import type { AnswerStep } from './answers';
import { createDeviceGraph, type DeviceGraph } from './device-graph';
import { formatEventId } from './event-id';
import { link, linkSoul, type NodeStore } from './node-store';
import { canonicalJson } from './keys';
import { graphSouls, talkStructureKey, talkStructureOf } from './talk-structure';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type MirrorStatus = {
  talks: number;
  versions: number;
  received: number;
  answers: number;
  skipped: number;
  mismatches: number;
  errors: number;
  lastError?: string;
  lastMismatch?: string;
  /** Milliseconds the latest mirrored entry took, and the slowest so far (diagnostics). */
  lastMs?: number;
  maxMs?: number;
};

export function createGraphMirror(store: NodeStore, options: { randomBytes: (length: number) => Uint8Array; prefix?: string; now?: () => number; log?: (message: string) => void; graph?: DeviceGraph;
  /** Received Talks arrive over graph links under their real ids: mirror only my own Talks. */
  ownTalksOnly?: boolean;
}) {
  const prefix = options.prefix ?? 'local/';
  const souls = graphSouls(prefix);
  const statusSoul = souls.index('mirror');
  const graph = options.graph ?? createDeviceGraph(store, { randomBytes: options.randomBytes, prefix, ...(options.now ? { now: options.now } : {}) });
  const { talks, arrivals, answers } = graph;
  let queue: Promise<unknown> = Promise.resolve();

  // Counts are added up in memory and written once per entry (each write costs a storage flush).
  let pending: Record<string, number | string> = {};
  let statusQueue: Promise<void> = Promise.resolve();
  let maxMs = 0;
  async function bump(changes: Partial<Record<keyof MirrorStatus, number | string>>): Promise<void> {
    for (const [key, value] of Object.entries(changes)) {
      pending[key] = typeof value === 'number' ? Number(pending[key] ?? 0) + value : value;
    }
  }
  async function flushStatus(): Promise<void> {
    if (!Object.keys(pending).length) return;
    const changes = pending;
    pending = {};
    const current = (await store.get(statusSoul)) || {};
    const next: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(changes)) {
      next[key] = typeof value === 'number' && key !== 'lastMs' && key !== 'maxMs' ? Number(current[key] ?? 0) + value : value;
    }
    if (typeof next.maxMs === 'number') next.maxMs = Math.max(next.maxMs, Number(current.maxMs ?? 0));
    await store.put(statusSoul, next);
  }

  const legacySoul = (oldTalkId: string) => souls.index(`legacy/${encodeURIComponent(oldTalkId)}`);

  /** My own Talk: create it once, then a new version whenever its structure or title changes. */
  async function mirrorCreated(entry: any): Promise<void> {
    // The grammar filter corrects on write (spec §31.3a): receivers ignore a Talk with errors.
    const full = applyGrammarToTalk(entry.fullTalk);
    const structureKey = talkStructureKey(talkStructureOf(full));
    const title = String(full.title ?? entry.title ?? '');
    const legacy = await store.get(legacySoul(entry.talkId));
    const talk = { ...full, title, expiresAt: entry.expiresAt ?? full.expiresAt, locationRadiusMiles: entry.locationRadiusMiles ?? full.locationRadiusMiles };
    let talkId = (linkSoul(legacy?.talk) || '').slice(souls.event('').length);
    // A Talk retracted (a deletion event, sent to everyone) and then turned on again is a new
    // graph Talk: receivers keep the deleted one deleted.
    if (talkId && (await store.get(souls.mine(`talk/${talkId}`)))?.deleted === true) talkId = '';
    // The legacy map goes in the same write batch as the Talk's event.
    const legacyNode = (id: string) => ({ talk: link(souls.event(id)), title, structure: structureKey });
    if (!talkId) {
      talkId = await talks.create(talk, { active: !entry.disabled }, (id) => [store.put(legacySoul(entry.talkId), legacyNode(id))]);
      await bump({ talks: 1 });
    } else if (legacy?.structure !== structureKey || legacy?.title !== title) {
      const id = talkId;
      await talks.edit(talkId, talk, [store.put(legacySoul(entry.talkId), legacyNode(id)), talks.setState(talkId, { active: !entry.disabled })]);
      await bump({ versions: 1 });
    } else {
      await talks.setState(talkId, { active: !entry.disabled });
      return;
    }
    await verify(talkId, full, (id) => talks.read(id));
  }

  /** A Talk I received: its author's version, my arrival, and my answers when they change. */
  async function mirrorReceived(entry: any): Promise<void> {
    const full = entry.fullTalk;
    const legacy = await store.get(legacySoul(entry.talkId));
    let talkId = (linkSoul(legacy?.talk) || '').slice(souls.event('').length);
    const author = String(full.authorId || entry.senders?.[0] || 'unknown');
    if (!talkId) {
      const when = Date.parse(full.createdAt ?? entry.timestamp) || 0;
      const device = portableSha256Hex(`iinpublic-legacy-device-v1:${author}`).slice(0, 32);
      talkId = formatEventId({ when: Math.max(0, when), deviceId: device, counter: parseInt(portableSha256Hex(entry.talkId).slice(0, 8), 16) });
      const senders: string[] = entry.senders?.length ? entry.senders : [author];
      for (const sender of senders) {
        await arrivals.receive({ talkId, versionId: talkId, authorId: author, when, device, talk: full }, { userId: String(sender), importing: true });
      }
      await store.put(legacySoul(entry.talkId), { talk: link(souls.event(talkId)), title: String(full.title ?? ''), structure: talkStructureKey(talkStructureOf(full)) });
      await bump({ received: 1 });
      const read = await arrivals.read(talkId);
      if (!read) { await bump({ skipped: 1 }); return; }
      await verify(talkId, full, async () => read);
    }
    const completed: any[] = Array.isArray(entry.completedAnswers) ? entry.completedAnswers : [];
    if (!completed.length) return;
    const signature = portableSha256Hex(canonicalJson(completed.map((a) => [a.questionId, a.answerId])));
    if (legacy?.answers === signature) return;
    const talk = await arrivals.read(talkId);
    if (!talk) return;
    const steps: AnswerStep[] = [];
    for (const answer of completed) {
      const step = steps.find((s) => s.questionId === answer.questionId);
      if (step) step.answerIds!.push(String(answer.answerId));
      else steps.push({ questionId: String(answer.questionId), answerIds: [String(answer.answerId)] });
    }
    const mode = entry.answeredBy === 'chatbot' || completed.every((a) => a.mode === 'chatbot') ? 'chatbot' : 'manual';
    const previous = await answers.answered(talkId);
    await answers.answer({ talkId, structure: talk, steps, mode, withUser: author, ...(previous ? { replaces: previous } : {}) });
    await store.put(legacySoul(entry.talkId), { answers: signature });
    await bump({ answers: 1 });
  }

  /** Phase 4's check: the Talk read back from the graph has the structure that was written. */
  async function verify(talkId: string, full: any, read: (id: string) => Promise<any>): Promise<void> {
    const back = await read(talkId);
    const expected = talkStructureOf(full);
    const got = back ? talkStructureOf(back) : undefined;
    if (!got || canonicalJson(got) !== canonicalJson(expected)) {
      await bump({ mismatches: 1, lastMismatch: talkId });
      options.log?.(`[device-graph] read-back mismatch for ${talkId}`);
    }
  }

  // One write at a time per app Talk, whether from the queue or from `ensure`.
  const inFlight = new Map<string, Promise<void>>();
  function mirrorEntry(entry: any): Promise<void> {
    const key = String(entry?.talkId ?? '');
    const previous = inFlight.get(key) ?? Promise.resolve();
    const run = previous.then(() => mirrorEntryNow(entry), () => mirrorEntryNow(entry));
    inFlight.set(key, run.catch(() => undefined));
    void run.finally(() => { if (inFlight.get(key) === run) inFlight.delete(key); }).catch(() => undefined);
    return run;
  }

  async function mirrorEntryNow(entry: any): Promise<void> {
    if (!entry || typeof entry !== 'object' || !entry.talkId || !entry.fullTalk || !Array.isArray(entry.fullTalk.questions)) {
      await bump({ skipped: 1 });
      return;
    }
    // `copied` is someone else's Talk kept in my list (talk-completion.ts): received, not mine.
    // `ignored` is a list state, not an answer (nothing is mirrored for it).
    if (entry.role === 'created') await mirrorCreated(entry);
    else if ((entry.role === 'answered' || entry.role === 'copied') && !options.ownTalksOnly) await mirrorReceived(entry);
  }

  return {
    /** Called after the app's own write succeeded. Never throws. */
    onCollectionUpsert(collection: string, entries: Record<string, unknown>): Promise<void> {
      if (collection !== 'myTalks') return Promise.resolve();
      const run = queue.then(async () => {
        for (const entry of Object.values(entries)) {
          const started = Date.now();
          try {
            const written = () => ['talks', 'versions', 'received', 'answers'].reduce((sum, key) => sum + Number(pending[key] ?? 0), 0);
            const before = written();
            await mirrorEntry(entry);
            if (written() > before) {
              const ms = Date.now() - started;
              pending.lastMs = ms;
              maxMs = Math.max(maxMs, ms);
              pending.maxMs = maxMs;
            }
          } catch (error) {
            const message = (error as Error)?.message || String(error);
            options.log?.(`[device-graph] mirror failed: ${message}`);
            await bump({ errors: 1, lastError: message.slice(0, 300) });
          }
          // Not awaited: the counts are diagnostics, and their own queue keeps them in order.
          statusQueue = statusQueue.then(flushStatus).catch(() => undefined);
        }
      });
      queue = run.catch(() => undefined);
      return run.catch(() => undefined);
    },

    async status(): Promise<MirrorStatus> {
      await statusQueue;
      const node = (await store.get(statusSoul)) || {};
      const num = (key: string) => Number(node[key] ?? 0);
      const status: MirrorStatus = {
        talks: num('talks'), versions: num('versions'), received: num('received'), answers: num('answers'),
        skipped: num('skipped'), mismatches: num('mismatches'), errors: num('errors'),
      };
      if (typeof node.lastError === 'string') status.lastError = node.lastError;
      if (typeof node.lastMismatch === 'string') status.lastMismatch = node.lastMismatch;
      if (typeof node.lastMs === 'number') status.lastMs = node.lastMs;
      if (typeof node.maxMs === 'number') status.maxMs = node.maxMs;
      return status;
    },

    graph,

    /**
     * Mirror this one app Talk now, ahead of the queue (an offer is waiting on it), and return its
     * graph id. A write of the same Talk already running is waited for, never repeated.
     */
    async ensure(entry: any): Promise<string | undefined> {
      try { await mirrorEntry(entry); } catch (error) { options.log?.(`[device-graph] mirror failed: ${(error as Error).message}`); }
      const legacy = await store.get(legacySoul(String(entry?.talkId ?? '')));
      return (linkSoul(legacy?.talk) || '').slice(souls.event('').length) || undefined;
    },

    /** The graph Talk id of an app Talk id (`myTalks` key), once mirrored. */
    async graphTalkId(oldTalkId: string): Promise<string | undefined> {
      const legacy = await store.get(legacySoul(oldTalkId));
      return (linkSoul(legacy?.talk) || '').slice(souls.event('').length) || undefined;
    },

    /** Wait for queued mirror writes (tests, and a host shutting down). */
    idle(): Promise<void> { return queue.then(() => statusQueue); },
  };
}
