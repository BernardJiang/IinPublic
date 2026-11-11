/**
 * The answer outbox (OPEN-96 a): `graph.answer` requests kept until the answer is in its author's
 * pair log, which then carries it (re-sent while the author owes an acknowledgement, graph-sync).
 *
 * Before it, an answer whose send failed stayed only on this device: the author's keys or my graph
 * identity not known yet (the "not sent" warning), an error, or the process killed between saving
 * the answer and writing the log entry. On the 2026-10-31 walk PH-1 recorded a late chatbot answer
 * that its author never received. A kept answer is sent again when an identity or a link arrives,
 * also after a restart, since the outbox is in the device core's storage (`local/`, never shared).
 */
import type { CoreRequest } from './protocol';
import type { DeliveryStore } from './delivery';

export type AnswerRequest = Extract<CoreRequest, { name: 'graph.answer' }>;
export type AnswerResult = { sent: boolean; eventId?: string; reason?: string };

/** `answerAndSend` reasons that will not change on a later try: the answer is dropped, not kept. */
export const ANSWER_NOT_SENDABLE = new Set(['built-in values only', 'Talk not received from this author', 'no answer steps']);

export function createAnswerOutbox(deps: {
  delivery: DeliveryStore;
  send: (request: AnswerRequest) => Promise<AnswerResult>;
  log?: (message: string) => void;
}) {
  const { delivery } = deps;

  async function send(request: AnswerRequest): Promise<AnswerResult> {
    // A newer answer to the same Talk and author replaces a waiting one.
    await delivery.queueAnswer(request.talkId, request.authorId, request as unknown as Record<string, unknown>);
    const result = await deps.send(request);
    if (result.sent || !result.reason || ANSWER_NOT_SENDABLE.has(result.reason)) {
      await delivery.unqueueAnswer(request.talkId, request.authorId);
    }
    return result;
  }

  let running: Promise<void> | undefined;
  let again = false;
  /** Send every waiting answer once; a call while one runs makes it go round once more. */
  function resend(): Promise<void> {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        for (const queued of await delivery.queuedAnswers().catch(() => [])) {
          const result = await send(queued.request as unknown as AnswerRequest)
            .catch((error: Error) => ({ sent: false, reason: error.message }) as AnswerResult);
          if (result.sent) deps.log?.(`[answer-outbox] sent a waiting answer to ${queued.authorId.slice(0, 8)} for ${queued.talkId.slice(-8)}`);
        }
      } while (again);
    })().finally(() => { running = undefined; });
    return running;
  }

  /** My answers to this Talk were removed: a waiting one is not sent any more. */
  async function forget(talkId: string): Promise<void> {
    for (const queued of await delivery.queuedAnswers()) {
      if (queued.talkId === talkId) await delivery.unqueueAnswer(queued.talkId, queued.authorId);
    }
  }

  return { send, resend, forget };
}
