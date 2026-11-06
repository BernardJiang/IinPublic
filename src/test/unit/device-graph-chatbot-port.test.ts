/** @jest-environment node */

// OPEN-106 step 2e (v): the graph chatbot does what the old answer engine did
// (`answer-preference-engine.ts`, removed with its collections). Each case below was run through
// both before the engine went, and they agreed: Just once answers are suggestions only; a question
// first asked elsewhere gives my default later in a flow; Whenever offered; built-in values per
// Talk title; my place against theirs; passing a tag again.

import { createEventIdSource } from '../../core/device-graph/event-id';
import { memoryNodeStore } from '../../core/device-graph/node-store';
import { createAnswerGraph, resolveChatbotQuestion } from '../../core/device-graph/answers';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { talkStructureOf } from '../../core/device-graph/talk-structure';
import { createDeviceGraph } from '../../core/device-graph/device-graph';
import { createAppChatbot } from '../../core/device-graph/sync/app-chatbot';

/* eslint-disable @typescript-eslint/no-explicit-any */

function graph() {
  let clock = Date.UTC(2026, 10, 4, 10);
  let saved: { deviceId?: string; counter?: number } = {};
  const ids = createEventIdSource({
    state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } },
    now: () => clock, randomBytes: (n) => new Uint8Array(n).fill(7),
  });
  const store = memoryNodeStore();
  const options = { now: () => { clock += 1000; return clock; } };
  const arrivals = createArrivalGraph(store, ids, options);
  const answers = createAnswerGraph(store, ids, options);
  const talks = createTalkGraph(store, ids, options);
  let n = 0;
  async function receive(talk: any, author = `author${n += 1}`) {
    const when = Date.UTC(2026, 10, 4, 9) + n;
    const id = `${when}-${'c'.repeat(31)}${n.toString(16)}-1`;
    await arrivals.receive({ talkId: id, versionId: id, authorId: author, when, device: 'c'.repeat(32), talk }, { userId: author });
    return { id, talk: (await arrivals.read(id))! };
  }
  return { store, arrivals, answers, talks, receive };
}

const flow = (title: string, questions: Array<{ text: string; choices: string[] }>) => ({
  id: `talk-${title}`, title, type: 'flow', language: 'en', isAdult: false,
  questions: questions.map((q, i) => ({
    id: `q_${i}`, text: q.text,
    answers: [
      ...q.choices.map((text, j) => ({ id: `a_${i}_${j}`, text, ...(i < questions.length - 1 ? { nextQuestionId: `q_${i + 1}` } : { isMatch: true, isTerminal: true }) })),
      { id: `a_${i}_x`, text: 'Ignore', isIgnore: true, isTerminal: true },
    ],
  })),
});

describe('the graph chatbot does what the answer engine did', () => {
  it('a Just once answer is a suggestion, never answered by itself', async () => {
    const g = graph();
    const coffee = flow('Coffee', [{ text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]);
    const first = await g.receive(coffee);
    await g.answers.answer({ talkId: first.id, structure: first.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'], reuse: 'once' }] });

    const again = await g.receive(flow('Coffee', [{ text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]));
    expect((await g.answers.chatbot(again.talk)).pending).toBe('q_0');
    const view = await g.answers.chatbotView(again.talk);
    expect(resolveChatbotQuestion(again.talk, 'responder', view, [], 'q_0')).toMatchObject({ answerIds: ['a_0_0'], auto: false });
  });

  it('a question I answered where it was asked first is my default later in a flow', async () => {
    const g = graph();
    const coffee = flow('Coffee', [{ text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]);
    const first = await g.receive(coffee);
    await g.answers.answer({ talkId: first.id, structure: first.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_1'] }] });

    const breakfast = flow('Breakfast', [{ text: 'Breakfast out?', choices: ['Yes'] }, { text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]);
    const later = await g.receive(breakfast);
    await g.answers.answer({ talkId: later.id, structure: later.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_1'] }] });

    // A third Talk asks "Breakfast out?" differently worded first, then "Coffee or tea?".
    const brunch = flow('Brunch', [{ text: 'Brunch on Sunday?', choices: ['Yes'] }, { text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]);
    const third = await g.receive(brunch);
    const view = await g.answers.chatbotView(third.talk);
    expect(resolveChatbotQuestion(third.talk, 'responder', view, [{ questionId: 'q_0', answerIds: ['a_0_0'] }], 'q_1'))
      .toMatchObject({ answerIds: ['a_1_1'], reason: 'root-context', auto: true });
  });

  it('Whenever offered: the first offered of my preferences, wherever the question is asked', async () => {
    const g = graph();
    const fruit = flow('Fruit', [{ text: 'Which fruit?', choices: ['Apple', 'Kiwi', 'Pear'] }]);
    const first = await g.receive(fruit);
    await g.answers.answer({ talkId: first.id, structure: first.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'], reuse: 'whenever' }] });
    await g.answers.answer({ talkId: first.id, structure: first.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_1'], reuse: 'whenever' }] });

    const both = flow('Snack', [{ text: 'Which fruit?', choices: ['Pear', 'Apple', 'Kiwi', 'Plum'] }]);
    const withBoth = await g.receive(both);
    expect((await g.answers.chatbot(withBoth.talk)).answers).toEqual([{ questionId: 'q_0', answerIds: ['a_0_2'], reason: 'whenever-offered' }]);

    const appleOnly = flow('Lunch', [{ text: 'Which fruit?', choices: ['Apple', 'Plum'] }]);
    const withApple = await g.receive(appleOnly);
    expect((await g.answers.chatbot(withApple.talk)).answers[0]!.answerIds).toEqual(['a_0_0']);
  });

  it('built-in values are mine per Talk title: a book and a notebook under the same tag', async () => {
    const g = graph();
    const deal = (title: string, myTag: string, theirTag: string, priceRange: { min: number; max: number }) => ({
      title, type: 'flow', language: 'en', isAdult: false,
      questions: [
        { id: 'q_0', text: myTag, reciprocalTagContext: true, answers: [
          { id: 'a_0_0', text: theirTag, nextQuestionId: 'q_1' },
          { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true },
        ] },
        { id: 'q_1', text: 'Price range', builtIn: { kind: 'priceRange', priceRange }, answers: [
          { id: 'q_1_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
          { id: 'q_1_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
        ] },
      ],
    });
    await g.talks.create(deal('Notebook', 'Sell', 'Buy', { min: 300, max: 500 }));
    await g.talks.create(deal('Book', 'Sell', 'Buy', { min: 10, max: 20 }));
    const ask = async (title: string) => {
      const incoming = await g.receive(deal(title, 'Buy', 'Sell', { min: 15, max: 30 }));
      return (await g.answers.chatbot(incoming.talk)).answers[1]?.answerIds;
    };
    expect(await ask('Book')).toEqual(['q_1_compatible']);
    expect(await ask('Notebook')).toEqual(['q_1_incompatible']);
    expect(await ask('Lamp')).toBeUndefined(); // no value of mine for a lamp: asked
  });

  it('a location question compares our places only with my consent (the caller decides)', async () => {
    const g = graph();
    const near = {
      title: 'Walk', type: 'flow', language: 'en', isAdult: false,
      questions: [{ id: 'q_0', text: 'Near me?', builtIn: { kind: 'location' }, answers: [
        { id: 'q_0_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
        { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
      ] }],
    };
    const incoming = await g.receive(near);
    expect((await g.answers.chatbot(incoming.talk)).pending).toBe('q_0');
    expect((await g.answers.chatbot(incoming.talk, 'responder', { locationCompatible: () => true })).answers)
      .toEqual([{ questionId: 'q_0', answerIds: ['q_0_compatible'], reason: 'built-in' }]);
    expect((await g.answers.chatbot(incoming.talk, 'responder', { locationCompatible: () => false })).answers[0]!.answerIds).toEqual(['q_0_incompatible']);
  });

  it('a tag I passed is passed again; answering it takes the pass back', async () => {
    const g = graph();
    const tag = { id: 'tag-chess', title: 'Hobbies', type: 'tag', language: 'en', isAdult: false,
      questions: [{ id: 'q_0', text: 'Chess', answers: [{ id: 'a_0', text: 'Chess', isMatch: true }, { id: 'a_x', text: 'Ignore', isIgnore: true }] }] };
    const first = await g.receive(tag);
    expect(await g.answers.pass(talkStructureOf(first.talk))).toBe(true);

    const again = await g.receive(tag);
    expect((await g.answers.chatbotView(again.talk)).passed).toBe(true);

    await g.answers.answer({ talkId: again.id, structure: again.talk, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0'] }] });
    expect((await g.answers.chatbotView(again.talk)).passed).toBe(false);
    // A one-question Talk that is not a tag is never a pass.
    expect(await g.answers.pass(talkStructureOf(flow('Coffee', [{ text: 'Coffee or tea?', choices: ['Coffee'] }]) as any))).toBe(false);
  });

  it('a buy Talk and a sell Talk: the questions after the Pair tag are in one situation', async () => {
    const g = graph();
    const deal = (myTag: string, theirTag: string) => ({
      title: 'Phone', type: 'flow', language: 'en', isAdult: false,
      questions: [
        { id: 'q_0', text: myTag, reciprocalTagContext: true, answers: [
          { id: 'a_0_0', text: theirTag, nextQuestionId: 'q_1' },
          { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true },
        ] },
        { id: 'q_1', text: 'Storage?', answers: [
          { id: 'a_1_0', text: '128GB', isMatch: true, isTerminal: true },
          { id: 'a_1_1', text: '256GB', isIgnore: true, isTerminal: true },
        ] },
      ],
    });
    // My sell Talk, answered by me as its author: 128GB.
    const mine = await g.talks.create(deal('Sell', 'Buy'));
    const own = (await g.talks.read(mine))!;
    await g.answers.answer({ talkId: mine, structure: own, mode: 'manual', perspective: 'author', steps: [
      { questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] },
    ] });
    const buy = await g.receive(deal('Buy', 'Sell'));
    expect((await g.answers.chatbot(buy.talk)).answers).toEqual([
      { questionId: 'q_0', answerIds: ['a_0_0'], reason: 'pair-tag' },
      { questionId: 'q_1', answerIds: ['a_1_0'], reason: 'same-context' },
    ]);
    // Someone else's buy Talk asks me as a buyer: my sell answer is not used there.
    const asBuyer = await g.receive(deal('Sell', 'Buy'));
    expect((await g.answers.chatbot(asBuyer.talk)).pending).toBe('q_1');
  });

  it('a fan-out branch the chatbot cannot finish is left out; the others are answered', async () => {
    const g = graph();
    // The template's confirm text names the branch's gender; editing a branch changes its tags only.
    const branch = (id: string, myGender: string, accepted: string, confirm: string) => [
      { id, text: myGender, reciprocalTagContext: true, contextPath: [{ questionId: 'q_0', answerId: 'q_0_compatible' }],
        answers: [{ id: `${id}_a`, text: accepted, nextQuestionId: `${id}c` }] },
      { id: `${id}c`, text: `Confirm: interested in ${confirm}?`, contextPath: [{ questionId: 'q_0', answerId: 'q_0_compatible' }, { questionId: id, answerId: `${id}_a` }],
        answers: [{ id: `${id}c_yes`, text: 'Yes', isMatch: true, isTerminal: true }] },
    ];
    const dating = (myGender: string, accepted: [string, string]) => ({
      title: 'Dating', type: 'route', language: 'en', isAdult: true,
      questions: [
        { id: 'q_0', text: 'Age range?', contextPath: [], builtIn: { kind: 'ageRange', ageRange: { age: 28, acceptableRange: { min: 21, max: 45 } } },
          answers: [{ id: 'q_0_compatible', text: 'Compatible', isMatch: true, nextQuestionIds: ['q_1', 'q_2'], parallelMatchThreshold: 1 },
            { id: 'q_0_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true }] },
        ...branch('q_1', myGender, accepted[0], 'Men'), ...branch('q_2', myGender, accepted[1], 'Women'),
      ],
    });
    // Eve, a woman interested in men, says so on both branches of her own Talk.
    const mine = await g.talks.create(dating('Women', ['Men', 'Men']));
    const own = (await g.talks.read(mine))!;
    await g.answers.answer({ talkId: mine, structure: own, mode: 'manual', perspective: 'author', steps: [
      { questionId: 'q_0', answerIds: ['q_0_compatible'], typed: { kind: 'ageRange', age: 28, rangeMin: 21, rangeMax: 45 } },
      { questionId: 'q_1', answerIds: ['q_1_a'] }, { questionId: 'q_1c', answerIds: ['q_1c_yes'] },
      { questionId: 'q_2', answerIds: ['q_2_a'] }, { questionId: 'q_2c', answerIds: ['q_2c_yes'] },
    ] });
    // Adam, a man, accepts men on one branch and women on the other: only "women" is Eve's.
    const adam = await g.receive(dating('Men', ['Men', 'Women']));
    const reply = await g.answers.chatbot(adam.talk);
    expect(reply.complete).toBe(true);
    expect(reply.answers.map((a) => a.questionId)).toEqual(['q_0', 'q_1', 'q_2', 'q_2c']);
  });

  it('answered already means this version: an edit of the Talk is answered again', async () => {
    const graphOf = createDeviceGraph(memoryNodeStore(), { randomBytes: (n) => new Uint8Array(n).fill(9) });
    const app = createAppChatbot({ graph: graphOf });
    const talk = flow('Coffee', [{ text: 'Coffee or tea?', choices: ['Coffee', 'Tea'] }]);
    const device = 'e'.repeat(32);
    const v1 = `${Date.now() - 60_000}-${device}-1`;
    await graphOf.arrivals.receive({ talkId: v1, versionId: v1, authorId: 'ann', when: Date.now() - 60_000, device, talk }, { userId: 'ann' });
    const structure = (await graphOf.arrivals.read(v1))!;
    await graphOf.answers.answer({ talkId: v1, structure, mode: 'manual', withUser: 'ann', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }] });
    expect((await app.answer(talk, { talkId: v1 })).answered).toBe(true);
    const v2 = `${Date.now() + 60_000}-${device}-2`;
    await graphOf.arrivals.receive({ talkId: v1, versionId: v2, authorId: 'ann', when: Date.now() + 60_000, device, talk: { ...talk, title: 'Coffee break' } }, { userId: 'ann' });
    expect((await app.answer(talk, { talkId: v1 })).answered).toBe(false);
  });
});
