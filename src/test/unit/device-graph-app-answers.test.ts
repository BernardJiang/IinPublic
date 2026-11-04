/** @jest-environment node */

// OPEN-106: every answer the app saves becomes one answer event in the device graph (by hand, by
// the chatbot, my own tag), the Me tab reads them back, and removing them deletes them (and tells
// the author when the Talk came over a graph link).

import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { formatEventId } from '../../core/device-graph/event-id';
import { createAppAnswers } from '../../core/device-graph/sync/app-answers';

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
  const ownTalks = {
    graphTalkId: async (id: string) => own.get(id),
    appTalkId: async (talkId: string) => [...own].find(([, graphId]) => graphId === talkId)?.[0] ?? talkId,
  };
  const localBodies = new Map<string, any>();
  const app = createAppAnswers({ store, graph, ownTalks, sync: () => sync as any, localTalk: async (id) => localBodies.get(id) });
  return { store, graph, own, sync, app, localBodies };
}

let counter = 1;
/** A Talk received over a graph link: the app knows it by its graph id. */
async function received(d: ReturnType<typeof setup>, author = 'adam', talk: any = tennis()) {
  const when = Date.now() - 1000;
  const device = (author.charCodeAt(0) % 16).toString(16).repeat(32);
  const talkId = formatEventId({ when, deviceId: device, counter: counter++ });
  await d.graph.arrivals.receive({ talkId, versionId: talkId, authorId: author, when, device, talk }, { userId: author });
  return talkId;
}

const record = (talkId: string, items: any[], extra: Record<string, unknown> = {}) => ({ [`key:${talkId}`]: { id: `key:${talkId}`, talkId, items, senderIds: [], ...extra } });
const weekly = [{ questionId: 'q_0', answerId: 'a_0_0' }, { questionId: 'q_1', answerId: 'a_1_0' }];

describe('app answers in the device graph', () => {
  it('a received Talk: saved once, sent once, listed for the Me tab, deleted with a notice to its author', async () => {
    const d = setup();
    const talkId = await received(d);
    await d.app.recordHistory(record(talkId, weekly, { senderIds: ['adam'] }));
    const first = await d.graph.answers.answered(talkId);
    expect(first).toBeTruthy();
    // The app saves its history often: the same answers are not written again.
    await d.app.recordHistory(record(talkId, weekly, { senderIds: ['adam'] }));
    expect(await d.graph.answers.answered(talkId)).toBe(first);
    // Sending reuses the event already written.
    expect(await d.app.answerAndSend(talkId, 'adam', weekly, 'manual', { responseId: 'r1' })).toEqual({ sent: true, eventId: first });
    expect(d.sync.sendAnswer).toHaveBeenCalledWith(first, { responseId: 'r1' });

    const history = await d.app.history();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ appTalkId: talkId, graphTalkId: talkId, eventId: first, mine: false, withUser: 'adam', mode: 'manual' });
    expect(history[0]!.talk).toMatchObject({ title: 'Tennis partner' });
    expect(history[0]!.answers.map((a) => [a.questionId, a.answerId, a.answerText])).toEqual([['q_0', 'a_0_0', 'Yes'], ['q_1', 'a_1_0', 'Weekly']]);

    // A changed answer (the chatbot's this time) replaces it.
    await d.app.recordHistory(record(talkId, [{ questionId: 'q_0', answerId: 'a_0_1' }], { answeredBy: 'chatbot', senderIds: ['adam'] }));
    const [changed] = await d.app.history();
    expect(changed!.eventId).not.toBe(first);
    expect(changed).toMatchObject({ mode: 'chatbot' });
    expect(changed!.answers.map((a) => a.answerId)).toEqual(['a_0_1']);

    // Removed: a deletion event; the author was sent an answer, so they are told.
    await d.app.answerAndSend(talkId, 'adam', [{ questionId: 'q_0', answerId: 'a_0_1' }], 'chatbot');
    expect(await d.app.forget(talkId)).toEqual({ deleted: 1, sent: 1 });
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
    expect(await d.app.answerAndSend('mine-1', 'adam', weekly, 'manual')).toEqual({ sent: false });
    expect(await d.app.forget('mine-1')).toEqual({ deleted: 1, sent: 0 });
    expect(d.sync.sendAnswerDeletion).not.toHaveBeenCalled();
  });

  it('the same Talk from two authors (starter tags) is answered once in the app: each author gets their own answer', async () => {
    const d = setup();
    const fromAnn = await received(d, 'ann');
    const fromCy = await received(d, 'cy');
    // The app's one row for both is keyed by Ann's Talk and names both senders.
    await d.app.recordHistory(record(fromAnn, weekly, { senderIds: ['ann', 'cy'] }));
    const [annEvent, cyEvent] = [await d.graph.answers.answered(fromAnn), await d.graph.answers.answered(fromCy)];
    expect(annEvent && cyEvent && annEvent !== cyEvent).toBe(true);
    expect(await d.app.answerAndSend(fromAnn, 'ann', weekly, 'manual')).toEqual({ sent: true, eventId: annEvent });
    expect(await d.app.answerAndSend(fromCy, 'cy', weekly, 'manual')).toEqual({ sent: true, eventId: cyEvent });
    // Not to the wrong author.
    expect(await d.app.answerAndSend(fromAnn, 'cy', weekly, 'manual')).toEqual({ sent: false });
    // The Me tab keeps one answer per question and situation: one row for the tag.
    expect(await d.app.history()).toHaveLength(1);
    expect(await d.app.forget(fromAnn, ['ann', 'cy'])).toEqual({ deleted: 2, sent: 2 });
  });

  it('the dialog\'s Just once and Whenever offered reach the chatbot', async () => {
    const d = setup();
    const once = await received(d, 'adam');
    await d.app.recordHistory(record(once, weekly.map((a) => ({ ...a, mode: 'manual' })), { senderIds: ['adam'] }));
    const again = await received(d, 'bea');
    const talk = (await d.graph.arrivals.read(again))!;
    expect((await d.graph.answers.chatbot(talk)).pending).toBe('q_0');

    const offered = await received(d, 'carl');
    await d.app.recordHistory(record(offered, weekly.map((a) => ({ ...a, mode: 'whenever' })), { senderIds: ['carl'] }));
    expect((await d.graph.answers.chatbot(talk)).answers).toEqual([
      { questionId: 'q_0', answerIds: ['a_0_0'], reason: 'whenever-offered' },
      { questionId: 'q_1', answerIds: ['a_1_0'], reason: 'whenever-offered' },
    ]);
  });

  it('my own Talk\'s built-in value is part of my answer: the questions after it are reused', async () => {
    const d = setup();
    const priced = (priceRange: { min: number; max: number }) => ({
      title: 'Bike', type: 'flow', language: 'en', isAdult: false,
      questions: [
        { id: 'q_0', text: 'Price range', builtIn: { kind: 'priceRange', priceRange }, answers: [
          { id: 'q_0_compatible', text: 'Compatible', nextQuestionId: 'q_1' },
          { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
        ] },
        { id: 'q_1', text: 'Colour?', answers: [{ id: 'a_1_0', text: 'Red', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Blue', isIgnore: true, isTerminal: true }] },
      ],
    });
    const mine = await d.graph.talks.create(priced({ min: 100, max: 200 }));
    d.own.set('app-bike', mine);
    // The app lists built-in values last; my self-answer to the colour comes first.
    await d.app.recordHistory(record('app-bike', [
      { questionId: 'q_1', answerId: 'a_1_0', mode: 'manual' },
      { questionId: 'q_0', answerId: 'typed:priceRange', typedValue: { kind: 'priceRange', priceRange: { min: 100, max: 200 } }, mode: 'typed' },
    ]));
    expect(await d.graph.answers.answered(mine)).toBeTruthy();

    const when = Date.now() - 500;
    const theirs = formatEventId({ when, deviceId: 'd'.repeat(32), counter: counter++ });
    await d.graph.arrivals.receive({ talkId: theirs, versionId: theirs, authorId: 'dan', when, device: 'd'.repeat(32), talk: priced({ min: 150, max: 300 }) }, { userId: 'dan' });
    expect((await d.graph.answers.chatbot((await d.graph.arrivals.read(theirs))!)).answers).toEqual([
      { questionId: 'q_0', answerIds: ['q_0_compatible'], typed: { kind: 'priceRange', min: 100, max: 200 }, reason: 'built-in' },
      { questionId: 'q_1', answerIds: ['a_1_0'], reason: 'same-context' },
    ]);
  });

  it('a Talk only the app has (a starter tag) still teaches the chatbot', async () => {
    const d = setup();
    d.localBodies.set('starter-tennis', { ...tennis(), id: 'starter-tennis' });
    await d.app.recordHistory(record('starter-tennis', weekly.map((a) => ({ ...a, mode: 'auto' })), { senderIds: ['starter'] }));
    expect(await d.graph.answers.answered('starter-tennis')).toBeTruthy();
    const later = await received(d, 'bea');
    expect((await d.graph.answers.chatbot((await d.graph.arrivals.read(later))!)).complete).toBe(true);
    expect(d.sync.sendAnswer).not.toHaveBeenCalled();
  });

  it('a history item names its choices by text: ids from another sender\'s copy do not mislead', async () => {
    const d = setup();
    const fromAdam = await received(d, 'adam');
    // Answered on a copy listing "Daily" first: its ids are a_1_0 = Daily, a_1_1 = Weekly.
    const items = [
      { questionId: 'q_0', answerId: 'a_0_0', prompt: 'Do you play tennis?', choice: 'Yes', kind: 'question' },
      { questionId: 'q_1', answerId: 'a_1_1', prompt: 'How often do you play?', choice: 'Weekly', kind: 'question' },
    ];
    await d.app.recordHistory(record(fromAdam, items, { senderIds: ['adam'] }));
    const event = (await d.graph.answers.answered(fromAdam))!;
    const set = (await d.graph.answers.answerSet(event))!;
    const texts = await Promise.all(Object.keys(set).map((context) => d.graph.answers.gaveTexts(event, context)));
    expect(texts.flat().sort()).toEqual(['Weekly', 'Yes']);
  });
});
