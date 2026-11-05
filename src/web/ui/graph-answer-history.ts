/**
 * The Me tab's answers from the device graph (OPEN-106): the core lists every Talk I answered with
 * my latest answers (`graph.answerHistory`), and each becomes the Me tab's record of it
 * (`answer-history-storage.ts` reads them, with what this page saved and the graph has not yet).
 */
import { checkIfMatch } from '../../shared/talk-engine';
import type { TypedAnswerValue } from '../../shared/typed-preference-store';
import { buildFlatAnswerHistoryRecord, type FlatAnswerHistoryMap, type FlatAnswerHistoryRecord } from './answer-history-records';

/* eslint-disable @typescript-eslint/no-explicit-any */

type GraphAnswerRecord = {
  appTalkId: string;
  when: number;
  mode: string;
  mine: boolean;
  withUser?: string;
  talk: Record<string, any>;
  answers: Array<{ questionId: string; answerId: string; answerText: string; isMatch?: boolean; isIgnore?: boolean; mode?: string; typedValue?: TypedAnswerValue }>;
};

let requester: (() => Promise<unknown>) | null = null;
let byTalk = new Map<string, FlatAnswerHistoryRecord>();
/** Each answered Talk's body, by app id: "already answered" by content (`answered-talks.ts`). */
let bodies = new Map<string, Record<string, any>>();
let signature = '';
let revision = 0;

/** Set by the app once the core can answer `graph.answerHistory`; null turns the graph source off. */
export function setGraphAnswerHistorySource(request: (() => Promise<unknown>) | null): void {
  requester = request;
  if (!request) { byTalk = new Map(); bodies = new Map(); signature = ''; revision += 1; }
}

/** One graph answer record as the app's history record. */
export function graphRecordToFlat(record: GraphAnswerRecord): FlatAnswerHistoryRecord {
  const talk = { ...record.talk, id: record.appTalkId };
  const outcome = record.mine
    ? (record.answers.some((a) => a.isMatch && !a.typedValue) ? 'match' : 'mismatch')
    : (checkIfMatch(talk, record.answers) ? 'match' : 'mismatch');
  return buildFlatAnswerHistoryRecord(
    record.appTalkId, talk,
    record.answers.map((a) => ({
      questionId: a.questionId, answerId: a.answerId, answerText: a.answerText,
      ...(a.mode ? { mode: a.mode } : {}), ...(a.typedValue ? { typedValue: a.typedValue } : {}),
    })),
    outcome, record.withUser ? [record.withUser] : [],
    { ...(record.mode === 'chatbot' ? { answeredBy: 'chatbot' as const } : {}), answeredAt: record.when },
  );
}

/** Ask the core again; true when the records changed (the caller then redraws). */
export async function refreshGraphAnswerHistory(): Promise<boolean> {
  if (!requester) return false;
  const records = await requester();
  if (!Array.isArray(records)) return false;
  const next = new Map<string, FlatAnswerHistoryRecord>();
  const nextBodies = new Map<string, Record<string, any>>();
  for (const record of records as GraphAnswerRecord[]) {
    if (!record?.appTalkId || !record.talk || !Array.isArray(record.answers) || !record.answers.length) continue;
    try {
      next.set(record.appTalkId, graphRecordToFlat(record));
      nextBodies.set(record.appTalkId, { ...record.talk, id: record.appTalkId });
    } catch { /* a Talk the app cannot show */ }
  }
  const nextSignature = JSON.stringify([...next.values()].map((r) => [r.id, r.answeredAt, r.items.map((i) => i.answerId)]));
  if (nextSignature === signature) return false;
  signature = nextSignature;
  byTalk = next;
  bodies = nextBodies;
  revision += 1;
  return true;
}

/**
 * The app's history with each Talk the graph has taken from the graph. An app record newer than
 * the graph's (an answer the core is still writing) wins until the next refresh.
 */
export function mergeGraphAnswerHistory(flat: FlatAnswerHistoryMap): FlatAnswerHistoryMap {
  if (!byTalk.size) return flat;
  const out: FlatAnswerHistoryMap = {};
  const newerInApp = new Set<string>();
  for (const [key, record] of Object.entries(flat)) {
    const graph = byTalk.get(record.talkId);
    if (graph && Date.parse(graph.answeredAt) >= Date.parse(record.answeredAt) - 1000) continue;
    if (graph) newerInApp.add(record.talkId);
    out[key] = record;
  }
  for (const record of byTalk.values()) if (!newerInApp.has(record.talkId)) out[record.id] = record;
  return out;
}

/** The graph's records, one per Talk (the Me tab's history, `answer-history-storage.ts`). */
export function graphHistoryRecords(): FlatAnswerHistoryRecord[] {
  return [...byTalk.values()];
}

/** The bodies of the Talks the graph says I answered, by app id, and a counter of their changes. */
export function graphAnsweredBodies(): { revision: number; bodies: ReadonlyMap<string, Record<string, any>> } {
  return { revision, bodies };
}

/** Diagnostics for e2e specs: the Talks whose Me tab answers come from the graph. */
export function graphAnswerHistoryTalkIds(): string[] {
  return [...byTalk.keys()];
}
