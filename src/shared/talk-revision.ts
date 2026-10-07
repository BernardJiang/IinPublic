import { buildIdentityPayloadFromTalk, hashIdentityPayload } from './cid';

/**
 * OPEN-40: a talk's delivery revision. The content identity (`computeTalkIdFromTalkData`) keys
 * answers, chatbot memory and "already exchanged" — it deliberately excludes the title and the
 * routing, so a routing-only edit is the SAME talk to a receiver. But that also meant the edit was
 * never re-sent. The revision adds the title and every routing field on top of the identity, so a
 * peer holding an older revision gets the update in place (same talk, same answers still valid).
 * Survey counters, timestamps and stats are excluded — they are not authored content.
 */
export function computeTalkRevisionHash(talk: any): string {
  const questions = Array.isArray(talk?.questions) ? talk.questions : [];
  const routing = questions.map((question: any) => ({
    id: String(question?.id ?? ''),
    next: question?.nextQuestionId ?? null,
    selection: question?.answerSelectionMode ?? null,
    answers: (Array.isArray(question?.answers) ? question.answers : []).map((answer: any) => ({
      id: String(answer?.id ?? ''),
      text: String(answer?.text ?? ''),
      match: answer?.isMatch === true,
      ignore: answer?.isIgnore === true,
      terminal: answer?.isTerminal === true,
      next: answer?.nextQuestionId ?? null,
      nextMany: Array.isArray(answer?.nextQuestionIds) ? answer.nextQuestionIds : null,
      threshold: answer?.parallelMatchThreshold ?? null,
    })),
  }));
  const payload = {
    identity: buildIdentityPayloadFromTalk(talk),
    title: String(talk?.title ?? ''),
    matchThreshold: talk?.matchThreshold ?? null,
    routing,
  };
  return `rev_${hashIdentityPayload(JSON.stringify(payload))}`;
}
