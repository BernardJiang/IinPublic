/** @jest-environment node */

// OPEN-106: every answer the app saves becomes one answer event in the device graph (by hand, by
// the chatbot, my own tag), the Me tab reads them back, and removing them deletes them (and tells
// the author when the Talk came over a graph link).

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { formatEventId } from '../../core/device-graph/event-id';
import { appTalkSoul, createAppAnswers } from '../../core/device-graph/sync/app-answers';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (title = 'Tennis partner') => ({
  title, type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
});

let seed = 1;
function setup() {
  const store = memoryNodeStore();
  const graph = createDeviceGraph(store, { randomBytes: (n) => Uint8Array.from({ length: n }, () => (seed++ * 37) % 256) });
  const own = new Map<string, string>();
  const sync = { sendAnswer: jest.fn(async () => undefined), sendAnswerDeletion: jest.fn(async () => undefined) };
  const app = createAppAnswers({ store, graph, ownTalkId: async (id) => own.get(id), sync: () => sync as any });
  return { store, graph, own, sync, app };
}

async function received(d: ReturnType<typeof setup>, appTalkId: string, author = 'adam') {
  const when = Date.now() - 1000;
  const device = 'a'.repeat(32);
  const talkId = formatEventId({ when, deviceId: device, counter: 1 });
  await d.graph.arrivals.receive({ talkId, versionId: talkId, authorId: author, when, device, talk: tennis() }, { userId: author });
  await d.store.put(appTalkSoul(d.graph.prefix, appTalkId), { talk: talkId, author });
  return talkId;
}

const record = (talkId: string, items: any[], extra: Record<string, unknown> = {}) => ({ [`key:${talkId}`]: { id: `key:${talkId}`, talkId, items, ...extra } });
const weekly = [{ questionId: 'q_0', answerId: 'a_0_0' }, { questionId: 'q_1', answerId: 'a_1_0' }];

describe('app answers in the device graph', () => {
  it('a received Talk: saved once, sent once, listed for the Me tab, deleted with a notice to its author', async () => {
    const d = setup();
    const talkId = await received(d, 'app-1');
    await d.app.recordHistory(record('app-1', weekly));
    const first = await d.graph.answers.answered(talkId);
    expect(first).toBeTruthy();
    // The app saves its history often: the same answers are not written again.
    await d.app.recordHistory(record('app-1', weekly));
    expect(await d.graph.answers.answered(talkId)).toBe(first);
    // Sending reuses the event already written.
    expect(await d.app.answerAndSend('app-1', weekly, 'manual', { responseId: 'r1' })).toEqual({ sent: true, eventId: first });
    expect(d.sync.sendAnswer).toHaveBeenCalledWith(first, { responseId: 'r1', appTalkId: 'app-1' });

    const history = await d.app.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ appTalkId: 'app-1', graphTalkId: talkId, eventId: first, mine: false, withUser: 'adam', mode: 'manual' });
    expect(history[0]!.talk).toMatchObject({ title: 'Tennis partner' });
    expect(history[0]!.answers.map((a) => [a.questionId, a.answerId, a.answerText])).toEqual([['q_0', 'a_0_0', 'Yes'], ['q_1', 'a_1_0', 'Weekly']]);

    // A changed answer (the chatbot's this time) replaces it.
    await d.app.recordHistory(record('app-1', [{ questionId: 'q_0', answerId: 'a_0_1' }], { answeredBy: 'chatbot' }));
    const [changed] = await d.app.history();
    expect(changed!.eventId).not.toBe(first);
    expect(changed).toMatchObject({ mode: 'chatbot' });
    expect(changed!.answers.map((a) => a.answerId)).toEqual(['a_0_1']);

    // Removed: a deletion event; the author was sent an answer, so they are told.
    await d.app.answerAndSend('app-1', [{ questionId: 'q_0', answerId: 'a_0_1' }], 'chatbot');
    expect(await d.app.forget('app-1')).toEqual({ deleted: true, sent: true });
    expect(d.sync.sendAnswerDeletion).toHaveBeenCalledTimes(1);
    expect(await d.app.history()).toEqual([]);
  });

  it('my own Talk answered by me is listed from my side; typed answers and unknown Talks are left to the app', async () => {
    const d = setup();
    const talkId = await d.graph.talks.create(tennis('My tag'));
    d.own.set('mine-1', talkId);
    await d.app.recordHistory({ ...record('mine-1', weekly), ...record('frames-only', weekly), ...record('typed', [{ questionId: 'q_0', answerId: 'typed:age', typedValue: { kind: 'age' } }]) });
    const history = await d.app.history();
    expect(history.map((h) => [h.appTalkId, h.mine])).toEqual([['mine-1', true]]);
    expect(history[0]!.answers.map((a) => a.answerId)).toEqual(['a_0_0', 'a_1_0']);
    // Not received over a link: nothing to send, and removing tells no one.
    expect(await d.app.answerAndSend('mine-1', weekly, 'manual')).toEqual({ sent: false });
    expect(await d.app.forget('mine-1')).toEqual({ deleted: true, sent: false });
    expect(d.sync.sendAnswerDeletion).not.toHaveBeenCalled();
  });
});
