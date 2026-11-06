/**
 * What one Talk exchange records (OPEN-91 P4), moved out of `app.ts` (`recordLocalTalkExchange`):
 * the exchange log's record (OPEN-88: one per direction, with where it happened) and, for a Talk
 * of mine someone answered, how I decided it (`ix/outcome`, OPEN-106 step 3). Pure; the caller
 * writes them.
 */
import type { OutcomeRecord } from './device-graph/exchanged';
import type { ExchangeRecord } from './exchanges';

export type ExchangeInput = {
  peerId: string;
  peerName: string;
  talkId: string;
  talkData: any;
  outcome: 'match' | 'mismatch' | 'ignore';
  meta?: {
    responseId?: string;
    version?: number;
    respondedAt?: string;
    answers?: any[];
    direction?: 'sent' | 'received';
  };
  /** The room I was in (OPEN-89): a place leads to what was exchanged there. */
  room?: { roomId: string; roomName: string };
  /** The physical-world collection outing this author-side exchange belongs to, if any. */
  collectionTag?: Partial<ExchangeRecord> | null;
  nowIso: string;
};

export function exchangeRecordFor(input: ExchangeInput): ExchangeRecord {
  const { meta } = input;
  return {
    peerId: input.peerId,
    peerName: String(input.peerName || 'Unknown'),
    talkId: input.talkId,
    title: String(input.talkData?.title || 'Talk'),
    type: String(input.talkData?.type || 'flow'),
    language: String(input.talkData?.language || 'en'),
    outcome: input.outcome,
    direction: meta?.direction || 'sent',
    date: input.nowIso,
    ...(input.room ? { roomId: input.room.roomId, roomName: input.room.roomName } : {}),
    answerMode: 'manual',
    ...(meta?.answers ? { answers: meta.answers } : {}),
    ...(meta?.responseId ? { responseId: meta.responseId } : {}),
    ...(meta?.version !== undefined ? { version: meta.version } : {}),
    ...(meta?.respondedAt ? { respondedAt: meta.respondedAt } : {}),
    ...(input.collectionTag || {}),
  } as ExchangeRecord;
}

/**
 * How I decided an answer to a Talk of mine (step 8), or null for a Talk someone sent me: that
 * side is recorded when I answer (`submitTalkResponsePairDirect`).
 */
export function authorOutcomeFor(input: ExchangeInput): { talkId: string; responderId: string; record: OutcomeRecord } | null {
  if (input.meta?.direction === 'received') return null;
  return {
    talkId: input.talkId,
    responderId: input.peerId,
    record: {
      outcome: input.outcome === 'match' ? 'matched' : 'ignored',
      version: input.meta?.version ?? 1,
      responseId: input.meta?.responseId ?? `resp_${input.talkId}_${input.peerId}`,
      respondedAt: input.meta?.respondedAt ?? input.nowIso,
    },
  };
}
