/**
 * My answer to a Talk, committed before any transport sees it (step 9): its id, its version
 * (REQ-LEDGER-04: a different answer than last time is the next version), whether it matches, and
 * the record of it in the graph (`ix/responded`, OPEN-106 step 3) and in the delivery journal.
 * Every write here succeeds before the answer is sent.
 */
import { canonicalSerialize, computeResponseId } from '../shared/cid';
import { checkIfMatch } from '../shared/talk-engine';
import type { P2PMeshTalkResponsePayload } from '../shared/p2p-mesh-protocol';
import { isResponseComplete, isIgnoreAnswerSet, nextResponseVersion } from './response-rules';
import { isSeaCiphertext } from './sharing-policy';
import type { DeliveryStore } from './delivery';
import type { ExchangeIndex } from './device-graph/exchanged';

export type ResponseCommitInput = {
  talkId: string; talkData: any; answers: any[]; authorId: string; authorName: string; authorEpub?: string | undefined;
  responderId: string; responderEpub?: string | undefined; payloadCiphertext: string; submittedAt: string; selfTag?: string | undefined;
};
export type CommittedResponse = {
  payload: P2PMeshTalkResponsePayload; isMatch: boolean; isIgnore: boolean; isContentChange: boolean;
};

export async function commitResponse(input: ResponseCommitInput, deps: {
  delivery: DeliveryStore;
  exchange: ExchangeIndex;
  /** The author deleted this Talk. */
  retracted: (talkId: string) => Promise<boolean>;
}): Promise<CommittedResponse> {
  if (!input.authorId || !input.responderId || input.authorId === input.responderId || !input.talkId) throw new Error('Invalid response participants');
  if (!Array.isArray(input.answers) || !isResponseComplete(input.talkData, input.answers)) throw new Error('Incomplete response');
  if (!isSeaCiphertext(input.payloadCiphertext)) throw new Error('Response must be encrypted');
  if (await deps.retracted(input.talkId)) throw new Error('Talk has been retracted');
  const prior = await deps.exchange.responded(input.talkId, input.authorId);
  const responseId = await computeResponseId({ talkId: input.talkId, responderId: input.responderId, responseContentJson: canonicalSerialize(input.answers) });
  const version = nextResponseVersion(prior?.responseId || null, prior?.version ?? 0, responseId);
  const isMatch = checkIfMatch(input.talkData, input.answers, input.selfTag);
  const payload: P2PMeshTalkResponsePayload = {
    responseId, talkId: input.talkId, authorId: input.authorId, responderId: input.responderId,
    submittedAt: input.submittedAt, respondedAt: input.submittedAt, version,
    encryption: 'sea-ecdh-v1', payloadCiphertext: input.payloadCiphertext, transportMode: 'mesh-p2p',
    ...(input.responderEpub ? { responderEpub: input.responderEpub } : {}),
  };
  await deps.delivery.putSentResponse(payload);
  await deps.delivery.record({ objectId: responseId, recipientId: input.authorId, objectKind: 'talk-response', state: 'committed' });
  await deps.exchange.setResponded(input.talkId, input.authorId, { outcome: isMatch ? 'matched' : 'ignored', version, responseId, respondedAt: input.submittedAt });
  return { payload, isMatch, isIgnore: isIgnoreAnswerSet(input.answers), isContentChange: !!prior?.responseId && prior.responseId !== responseId };
}
