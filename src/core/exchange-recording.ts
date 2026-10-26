/**
 * What one Talk exchange records (OPEN-91 P4), moved out of `app.ts` (`recordLocalTalkExchange`):
 * the exchange log's record (OPEN-88: one per direction, with where it happened) and, for a Talk
 * of mine someone answered, the delivery ledger's author outcome and exchanged entries. Pure; the
 * caller writes them.
 */
import { buildTalkIdentityKey } from '../shared/cid';
import type { LedgerEvent } from '../shared/talk-ledger';
import type { ExchangeRecord } from './exchanges';
import { selectedTalkIdentityKeys } from './talk-rules';

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
 * The ledger writes for an answer to a Talk of mine (step 8), or null for a Talk someone sent me:
 * that side is recorded when I answer (`submitTalkResponsePairDirect`), and an author-side write
 * here would reuse the same key and erase change-of-mind fan-out targets. A match covers the tags
 * selected; anything else the whole Talk.
 */
export function authorLedgerWritesFor(input: ExchangeInput, authorId: string): {
  event: LedgerEvent;
  exchanged: { responderId: string; identityKeys: string[]; outcome: 'matched' | 'ignored'; version: number; respondedAt: string };
} | null {
  if (input.meta?.direction === 'received') return null;
  const outcome = input.outcome === 'match' ? 'matched' : 'ignored';
  const wholeTalkIdentityKey = buildTalkIdentityKey(input.talkData);
  const version = input.meta?.version ?? 1;
  const respondedAt = input.meta?.respondedAt ?? input.nowIso;
  return {
    event: {
      kind: 'TALK_ANSWERED',
      responderId: input.peerId,
      talkId: input.talkId,
      authorId,
      identityKey: wholeTalkIdentityKey,
      outcome,
      version,
      responseId: input.meta?.responseId ?? `resp_${input.talkId}_${input.peerId}`,
      respondedAt,
      now: input.nowIso,
    },
    exchanged: {
      responderId: input.peerId,
      identityKeys: input.outcome === 'match' ? selectedTalkIdentityKeys(input.talkData, input.meta?.answers) : [wholeTalkIdentityKey],
      outcome,
      version,
      respondedAt,
    },
  };
}
