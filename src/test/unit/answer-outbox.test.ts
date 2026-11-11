/** @jest-environment node */

// OPEN-96 (a): an answer whose send failed is kept in the device core's outbox and sent again when
// an identity or a link arrives — also by a new core over the same storage (after a restart) —
// instead of staying only on the answering device.

import { createAnswerOutbox, type AnswerRequest, type AnswerResult } from '../../core/answer-outbox';
import { DeliveryStore } from '../../core/delivery';
import { memoryGraphStore } from '../../core/graph-store';

const answer = (talkId: string, authorId: string, answerId = 'a1'): AnswerRequest => ({
  name: 'graph.answer', talkId, authorId, answers: [{ questionId: 'q1', answerId }], mode: 'chatbot',
  context: { responderName: 'journey-bob', isChatbotResponse: true },
});

function harness(store = memoryGraphStore()) {
  const delivery = new DeliveryStore(store);
  const sent: AnswerRequest[] = [];
  let next: (request: AnswerRequest) => Promise<AnswerResult> = async () => ({ sent: true });
  const outbox = createAnswerOutbox({
    delivery,
    send: async (request) => {
      const result = await next(request);
      if (result.sent) sent.push(request);
      return result;
    },
  });
  return { store, delivery, outbox, sent, failWith: (f: typeof next) => { next = f; } };
}

describe('answer outbox (OPEN-96 a)', () => {
  it('keeps an answer whose send threw and sends it on the next resend, after a restart too', async () => {
    const before = harness();
    before.failWith(async () => { throw new Error('no public keys for author-1'); });
    await expect(before.outbox.send(answer('talk-late', 'author-1'))).rejects.toThrow('no public keys');
    expect(await before.delivery.queuedAnswers()).toHaveLength(1);

    // The process restarts: a new core over the same storage, and the author's keys are known now.
    const after = harness(before.store);
    await after.outbox.resend();
    expect(after.sent.map((r) => [r.talkId, r.authorId, r.context?.responderName])).toEqual([['talk-late', 'author-1', 'journey-bob']]);
    expect(await after.delivery.queuedAnswers()).toEqual([]);
  });

  it('keeps an answer not sent for a reason that can change (no graph identity yet)', async () => {
    const h = harness();
    h.failWith(async () => ({ sent: false, reason: 'no graph identity yet' }));
    expect((await h.outbox.send(answer('t1', 'a1'))).sent).toBe(false);
    expect(await h.delivery.queuedAnswers()).toHaveLength(1);
    h.failWith(async () => ({ sent: true, eventId: 'ev1' }));
    await h.outbox.resend();
    expect(h.sent).toHaveLength(1);
    expect(await h.delivery.queuedAnswers()).toEqual([]);
  });

  it('drops an answer that can never be sent, and does not keep a sent one', async () => {
    const h = harness();
    h.failWith(async () => ({ sent: false, reason: 'Talk not received from this author' }));
    await h.outbox.send(answer('t1', 'a1'));
    h.failWith(async () => ({ sent: true }));
    await h.outbox.send(answer('t2', 'a1'));
    expect(await h.delivery.queuedAnswers()).toEqual([]);
  });

  it('a newer answer to the same Talk and author replaces the waiting one', async () => {
    const h = harness();
    h.failWith(async () => ({ sent: false, reason: 'no graph identity yet' }));
    await h.outbox.send(answer('t1', 'a1', 'first'));
    await h.outbox.send(answer('t1', 'a1', 'second'));
    const queued = await h.delivery.queuedAnswers();
    expect(queued).toHaveLength(1);
    expect((queued[0]!.request as unknown as AnswerRequest).answers[0]!.answerId).toBe('second');
  });

  it('a removed answer is not sent later', async () => {
    const h = harness();
    h.failWith(async () => ({ sent: false, reason: 'no graph identity yet' }));
    await h.outbox.send(answer('t1', 'a1'));
    await h.outbox.send(answer('t2', 'a1'));
    await h.outbox.forget('t1');
    h.failWith(async () => ({ sent: true }));
    await h.outbox.resend();
    expect(h.sent.map((r) => r.talkId)).toEqual(['t2']);
  });

  it('a resend asked for while one runs goes round once more', async () => {
    const h = harness();
    h.failWith(async () => ({ sent: false, reason: 'no graph identity yet' }));
    await h.outbox.send(answer('t1', 'a1'));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    h.failWith(async () => { calls += 1; if (calls === 1) { await gate; return { sent: false, reason: 'no graph identity yet' }; } return { sent: true }; });
    const first = h.outbox.resend();
    const second = h.outbox.resend();
    release();
    await Promise.all([first, second]);
    expect(h.sent.map((r) => r.talkId)).toEqual(['t1']);
  });
});
