/**
 * The author's decision on an incoming Talk response (OPEN-91 P4): whether to take it, and what it
 * changes — a first match, a change of mind either way, a version bump, or nothing. Pure: the
 * caller supplies the earlier decision on this person's answer (`ix/outcome`, OPEN-106 step 3) and
 * the decrypted answers, and carries out the effects (the outcome record, the conversation,
 * notifications). Moved out of `app.ts` (`handleMeshTalkResponse`) so every host runs the same rule.
 */
import { checkIfMatch } from '../shared/talk-engine';
import { isResponseComplete } from './response-rules';
import type { OutcomeRecord } from './device-graph/exchanged';

export type ResponseIngestInput = {
  talkData: any;
  answers: Array<{ questionId: string; answerId: string; answerText?: string }>;
  /** How I decided this person's earlier answer to this Talk, if any. */
  prior?: OutcomeRecord | undefined;
  /** When I deleted the Talk, if I did (ms). */
  retractedAt?: number | undefined;
  responderId: string;
  authorId: string;
  talkId: string;
  responseId: string;
  version?: number;
  respondedAt?: string;
  submittedAt: string;
};

export type ResponseIngestDecision =
  | { kind: 'reject'; reason: 'incomplete-survey' | 'retracted' | 'stale' }
  /** No earlier answer from this person: record it; a match forms a conversation. */
  | { kind: 'first'; isMatch: boolean; version: number; respondedAt: string }
  /** They answered before and changed their mind. */
  | { kind: 'now-match' | 'no-longer-match' | 'unchanged'; isMatch: boolean; version: number; respondedAt: string; priorVersion: number };

/**
 * Two answers by one person to one Talk: > 0 when `incoming` is newer. A higher version wins; at
 * the same version the same response id is a replay (0), otherwise the later answer wins.
 */
export function compareResponse(
  existing: { version: number; respondedAt: string; responseId: string },
  incoming: { version: number; respondedAt: string; responseId: string },
): number {
  if (incoming.version !== existing.version) return incoming.version - existing.version;
  if (incoming.responseId === existing.responseId) return 0;
  return new Date(incoming.respondedAt).getTime() - new Date(existing.respondedAt).getTime();
}

export function decideResponseIngest(input: ResponseIngestInput): ResponseIngestDecision {
  const { talkData, answers, prior } = input;
  const version = input.version ?? 1;
  const respondedAt = input.respondedAt ?? input.submittedAt;

  // A survey answered only in part is not an answer, whatever the sender claims (TODO §W Gap 2:
  // the receiving half of the guard `submitTalkResponsePairDirect` applies when sending).
  if (!isResponseComplete(talkData, answers)) return { kind: 'reject', reason: 'incomplete-survey' };

  // Step 10: an answer given before I retracted the Talk is discarded.
  if (input.retractedAt !== undefined && new Date(respondedAt).getTime() < input.retractedAt) return { kind: 'reject', reason: 'retracted' };

  const isMatch = checkIfMatch(talkData, answers);
  if (!prior) return { kind: 'first', isMatch, version, respondedAt };

  // Step 9: only a newer answer replaces the earlier one.
  if (compareResponse(prior, { version, respondedAt, responseId: input.responseId }) <= 0) return { kind: 'reject', reason: 'stale' };

  const wasMatch = prior.outcome === 'matched';
  const kind = !wasMatch && isMatch ? 'now-match' : wasMatch && !isMatch ? 'no-longer-match' : 'unchanged';
  return { kind, isMatch, version, respondedAt, priorVersion: prior.version };
}
