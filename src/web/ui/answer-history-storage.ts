import type { TypedAnswerValue } from '../../shared/typed-preference-store';
import { buildFlatAnswerHistoryRecord, type FlatAnswerHistoryMap, type FlatAnswerHistoryRecord } from './answer-history-records';
import { graphHistoryRecords, refreshGraphAnswerHistory } from './graph-answer-history';
import { myTalksView } from '../services/core-views';

export { buildFlatAnswerHistoryRecord, getTalkContentKey, type FlatAnswerHistoryItem, type FlatAnswerHistoryMap, type FlatAnswerHistoryRecord } from './answer-history-records';

/**
 * The Me tab's answer history is the device graph's (OPEN-106): the core lists every Talk I
 * answered with my latest answers (`graph-answer-history.ts`), and the app writes and removes them
 * with core requests (`graph.recordAnswers`, `graph.forgetAnswers`). Nothing is stored twice; the
 * old `myAnswerHistory` collection is erased at start. Until the graph gives a record back, the one
 * this page saved stands in for it (`pending`), and a Talk whose answers were removed stays out.
 * Callers edit the returned map and hand it back, so reads are copies and only what changed is
 * written.
 */
type HistoryCore = (request: { name: 'graph.recordAnswers'; records: Record<string, unknown> } | { name: 'graph.forgetAnswers'; talkId: string; senders: string[] }) => Promise<unknown>;

let core: HistoryCore | null = null;
/** Records saved on this page, by id, until the graph has them. */
const pending = new Map<string, FlatAnswerHistoryRecord>();
/** Talks whose answers were removed on this page, until the graph no longer lists them. */
const removedTalks = new Set<string>();

/** Set by the app once the device core answers; records saved before then are sent now. */
export function setAnswerHistoryCore(request: HistoryCore | null): void {
  core = request;
  if (core && pending.size) send(Object.fromEntries(pending));
}

function send(records: Record<string, FlatAnswerHistoryRecord>): void {
  if (!core || !Object.keys(records).length) return;
  const request = core;
  const copy = JSON.parse(JSON.stringify(records));
  // After the My Talks writes already made: a new Talk of mine must be in the core (and so in the
  // graph) before my answers to it, or they are taken for answers to a Talk only the app has.
  void myTalksView.flush().catch(() => undefined)
    .then(() => request({ name: 'graph.recordAnswers', records: copy }))
    .then(() => refreshGraphAnswerHistory())
    .catch((error) => console.warn('[answer-history] not saved to the device graph:', error));
}

export function getFlatAnswerHistory(): FlatAnswerHistoryMap {
  const graph = graphHistoryRecords();
  for (const talkId of [...removedTalks]) if (!graph.some((record) => record.talkId === talkId)) removedTalks.delete(talkId);
  const out: FlatAnswerHistoryMap = {};
  const confirmed = new Set<string>();
  for (const [id, record] of pending) {
    const fromGraph = graph.find((r) => r.talkId === record.talkId);
    // The graph has this answer (or a newer one): its record is the one shown from now on.
    if (fromGraph && Date.parse(fromGraph.answeredAt) >= Date.parse(record.answeredAt) - 1000) { pending.delete(id); continue; }
    confirmed.add(record.talkId);
    out[id] = record;
  }
  for (const record of graph) {
    if (removedTalks.has(record.talkId) || confirmed.has(record.talkId)) continue;
    out[record.id] = record;
  }
  return JSON.parse(JSON.stringify(out)) as FlatAnswerHistoryMap;
}

export function setFlatAnswerHistory(history: FlatAnswerHistoryMap): void {
  const current = getFlatAnswerHistory();
  const changed = Object.fromEntries(Object.entries(history)
    .filter(([id, record]) => JSON.stringify(current[id]) !== JSON.stringify(record)));
  const kept = new Set(Object.values(history).map((record) => record.talkId));
  // A Talk none of whose records are left: my answers to it are removed (and its author told).
  const gone = new Map<string, Set<string>>();
  for (const record of Object.values(current)) {
    if (kept.has(record.talkId)) continue;
    const senders = gone.get(record.talkId) ?? new Set<string>();
    for (const sender of record.senderIds ?? []) senders.add(String(sender));
    gone.set(record.talkId, senders);
  }
  for (const [talkId, senders] of gone) {
    for (const [id, record] of pending) if (record.talkId === talkId) pending.delete(id);
    removedTalks.add(talkId);
    if (core) {
      void core({ name: 'graph.forgetAnswers', talkId, senders: [...senders] })
        .then(() => refreshGraphAnswerHistory())
        .catch((error) => console.warn('[answer-history] not removed from the device graph:', error));
    }
  }
  for (const [id, record] of Object.entries(changed)) {
    pending.set(id, JSON.parse(JSON.stringify(record)) as FlatAnswerHistoryRecord);
    removedTalks.delete(record.talkId);
  }
  send(changed);
}

export function upsertFlatAnswerHistory(record: FlatAnswerHistoryRecord): FlatAnswerHistoryMap {
  // One record per Talk: this one stands in for whatever the page or the graph had for it.
  for (const [id, other] of pending) if (other.talkId === record.talkId && id !== record.id) pending.delete(id);
  pending.set(record.id, JSON.parse(JSON.stringify(record)) as FlatAnswerHistoryRecord);
  removedTalks.delete(record.talkId);
  send({ [record.id]: record });
  return getFlatAnswerHistory();
}

/** Remove every Me-tab history record derived from one Talk. */
export function deleteFlatAnswerHistoryForTalk(talkId: string): void {
  const history = getFlatAnswerHistory();
  let changed = false;
  for (const [key, record] of Object.entries(history)) {
    if (record.talkId !== talkId) continue;
    delete history[key];
    changed = true;
  }
  if (changed) setFlatAnswerHistory(history);
}

/** Tests: forget this page's unsaved records and removals. */
export function resetAnswerHistoryForTests(): void {
  pending.clear();
  removedTalks.clear();
  core = null;
}


/**
 * Flattens a completed talk's answers into `FlatAnswerHistoryItem[]` (one row per
 * question/tag, deriving the display `choice`, `contextPath`/`contextLabel`, and
 * §LL.2's `booleanTag` distinction) and persists the record. Pure transform + a single
 * storage write — no DOM, no `UIManager` instance state.
 */
export function saveFlatAnswerHistoryRecord(
  talkId: string,
  talk: any,
  completedAnswers: Array<{
    questionId: string;
    answerId: string;
    answerText?: string;
    mode?: string;
    typedValue?: TypedAnswerValue;
  }>,
  outcome: 'match' | 'mismatch',
  senders: string[],
  opts: { answeredBy?: 'chatbot' } = {},
): void {
  upsertFlatAnswerHistory(buildFlatAnswerHistoryRecord(talkId, talk, completedAnswers, outcome, senders, opts));
}
