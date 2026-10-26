/**
 * The author's decision on an incoming Talk response (OPEN-91 P4): whether to take it, and what it
 * changes — a first match, a change of mind either way, a version bump, or nothing. Pure: the
 * caller supplies the ledger and the decrypted answers, and carries out the effects (the exchange
 * record, the conversation, notifications). Moved out of `app.ts` (`handleMeshTalkResponse`) so
 * every host runs the same rule.
 */
import { checkIfMatch } from '../shared/talk-engine';
import { isResponseComplete } from './response-rules';
import { applyEvent, outcomeKey, retractedKey, type TalkLedgerDoc } from '../shared/talk-ledger';

export type ResponseIngestInput = {
  talkData: any;
  answers: Array<{ questionId: string; answerId: string; answerText?: string }>;
  ledger: TalkLedgerDoc;
  /** The Talk's content identity (`buildTalkIdentityKey`). */
  identityKey: string;
  responderId: string;
  authorId: string;
  talkId: string;
  responseId: string;
  version?: number;
  respondedAt?: string;
  submittedAt: string;
  now: string;
};

export type ResponseIngestDecision =
  | { kind: 'reject'; reason: 'incomplete-survey' | 'retracted' | 'stale' }
  /** No earlier answer from this person: record it; a match forms a conversation. */
  | { kind: 'first'; isMatch: boolean; version: number; respondedAt: string }
  /** They answered before and changed their mind. */
  | { kind: 'now-match' | 'no-longer-match' | 'unchanged'; isMatch: boolean; version: number; respondedAt: string; priorVersion: number };

export function decideResponseIngest(input: ResponseIngestInput): ResponseIngestDecision {
  const { talkData, answers, ledger } = input;
  const version = input.version ?? 1;
  const respondedAt = input.respondedAt ?? input.submittedAt;

  // A survey answered only in part is not an answer, whatever the sender claims (TODO §W Gap 2:
  // the receiving half of the guard `submitTalkResponsePairDirect` applies when sending).
  if (!isResponseComplete(talkData, answers)) return { kind: 'reject', reason: 'incomplete-survey' };

  // Step 10: an answer given before I retracted the Talk is discarded.
  const tombstone = ledger.retracted[retractedKey(input.talkId, input.authorId)];
  if (tombstone && new Date(respondedAt).getTime() < tombstone.retractedAt) return { kind: 'reject', reason: 'retracted' };

  const isMatch = checkIfMatch(talkData, answers);
  const key = outcomeKey(input.responderId, input.talkId, input.authorId);
  const prior = ledger.outcomes[key];
  if (!prior) return { kind: 'first', isMatch, version, respondedAt };

  // Step 9: the ledger's version rule decides whether this replaces the earlier answer. Tried on a
  // copy; the caller's ledger is left as it was.
  const trial = JSON.parse(JSON.stringify(ledger)) as TalkLedgerDoc;
  const before = trial.outcomes[key]?.version ?? 0;
  applyEvent(trial, {
    kind: 'TALK_ANSWERED',
    responderId: input.responderId,
    talkId: input.talkId,
    authorId: input.authorId,
    identityKey: input.identityKey,
    outcome: isMatch ? 'matched' : 'ignored',
    version,
    responseId: input.responseId,
    respondedAt,
    now: input.now,
  });
  const after = trial.outcomes[key]?.version ?? 0;
  if (after <= before && trial.outcomes[key]?.responseId === prior.responseId) return { kind: 'reject', reason: 'stale' };

  const wasMatch = prior.outcome === 'matched';
  const kind = !wasMatch && isMatch ? 'now-match' : wasMatch && !isMatch ? 'no-longer-match' : 'unchanged';
  return { kind, isMatch, version, respondedAt, priorVersion: prior.version };
}
