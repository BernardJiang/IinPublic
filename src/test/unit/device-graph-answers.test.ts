/** @jest-environment node */

// Device graph, answers and arrivals (spec §31.4, §31.5, §31.8, OPEN-106): the chatbot answers by
// key lookup, the Me tab shows one question with answers from several Talks, repeats store no
// content, and a Talk with grammar errors is ignored whole.

import { createEventIdSource, parseEventId } from '../../core/device-graph/event-id';
import { memoryNodeStore } from '../../core/device-graph/node-store';
import { graphSouls, questionKeysOf, readTalkStructure, talkStructureOf } from '../../core/device-graph/talk-structure';
import { builtInCompatible, createAnswerGraph, situate } from '../../core/device-graph/answers';
import { createArrivalGraph, type IncomingTalk } from '../../core/device-graph/arrivals';
import { rebuildIndexes } from '../../core/device-graph/events';
import { createTalkGraph } from '../../core/device-graph/talk-events';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (choices0 = ['Yes', 'No'], title = 'Tennis partner') => ({
  title, type: 'flow', language: 'en', isAdult: false,
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: choices0.map((text, i) => ({
      id: `a_0_${i}`, text, ...(text === 'No' ? { isIgnore: true, isTerminal: true } : { nextQuestionId: 'q_1' }),
    })) },
    { id: 'q_1', text: 'How often do you play?', answers: [
      { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true },
      { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true },
    ] },
  ],
});

const phoneDeal = () => ({
  title: 'Phone deal', type: 'route', language: 'en', isAdult: false, matchThreshold: 2,
  questions: [
    { id: 'q_0', text: 'Buy', reciprocalTagContext: true, contextPath: [], answers: [
      { id: 'a_0_0', text: 'iPhone', nextQuestionIds: ['q_1', 'q_2'] },
      { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', text: 'Which model?', answerSelectionMode: 'multiple', contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }], answers: [
      { id: 'a_1_0', text: '15', isMatch: true, isTerminal: true },
      { id: 'a_1_1', text: '16', isMatch: true, isTerminal: true },
      { id: 'a_1_2', text: 'Ignore', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_2', text: 'Which colour?', contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }], answers: [
      { id: 'a_2_0', text: 'Black', isMatch: true, isTerminal: true },
      { id: 'a_2_1', text: 'Ignore', isIgnore: true, isTerminal: true },
    ] },
  ],
});

function bob() {
  let clock = Date.UTC(2026, 10, 2, 10);
  let saved: { deviceId?: string; counter?: number } = {};
  const ids = createEventIdSource({
    state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } },
    now: () => clock, randomBytes: (n) => new Uint8Array(n).fill(11),
  });
  const store = memoryNodeStore();
  const options = { now: () => { clock += 1000; return clock; } };
  return { store, arrivals: createArrivalGraph(store, ids, options), answers: createAnswerGraph(store, ids, options) };
}

let authorCounter = 0;
const offer = (talk: any, authorId: string): IncomingTalk => {
  authorCounter += 1;
  const talkId = `${1762000000000 + authorCounter}-${'a'.repeat(31)}${authorCounter % 10}-0`;
  return { talkId, versionId: talkId, authorId, when: 1762000000000 + authorCounter, device: 'a'.repeat(32), talk };
};

describe('Talks arriving (REQ-GRAPH-16, -21, -22)', () => {
  it('stores the author’s Talk once; a repeat arrival is one event and no content', async () => {
    const { store, arrivals } = bob();
    const incoming = offer(tennis(), 'adam');
    const first = await arrivals.receive(incoming, { userId: 'adam', link: 'webrtc' });
    const contentSouls = store.souls().filter((s) => /^local\/(q|a|rev)\//.test(s)).length;
    const again = await arrivals.receive(incoming, { userId: 'carol', link: 'bluetooth' });
    expect(store.souls().filter((s) => /^local\/(q|a|rev)\//.test(s)).length).toBe(contentSouls);
    expect(again.arrivalId).not.toBe(first.arrivalId);
    const talk = await arrivals.read(incoming.talkId);
    expect(talk).toMatchObject({ id: incoming.talkId, title: 'Tennis partner', senders: ['adam', 'carol'], latestArrival: again.arrivalId });
    expect(talk!.questions).toEqual(talkStructureOf(tennis()).questions);
    const arrival = await store.get(graphSouls().event(again.arrivalId!));
    expect(arrival).toMatchObject({ link: 'bluetooth', with: { '#': 'local/person/carol' }, re: { '#': graphSouls().event(incoming.talkId) } });
    expect(await arrivals.incoming()).toEqual([incoming.talkId]);
  });

  it('a newer version from any sender wins', async () => {
    const { arrivals } = bob();
    const v1 = offer(tennis(), 'adam');
    await arrivals.receive(v1, { userId: 'adam' });
    const v2: IncomingTalk = { ...v1, versionId: `${v1.when + 5000}-${'a'.repeat(32)}-1`, previousVersionId: v1.versionId, when: v1.when + 5000, talk: tennis(['Yes', 'No'], 'Tennis buddy') };
    await arrivals.receive(v2, { userId: 'carol' });
    await arrivals.receive(v1, { userId: 'dan' });
    expect((await arrivals.read(v1.talkId))!.title).toBe('Tennis buddy');
  });

  it('ignores a whole Talk with grammar errors, but records that it arrived', async () => {
    const { store, arrivals } = bob();
    const bad = offer({ ...tennis(), questions: [{ ...tennis().questions[0], text: 'do you play tennis' }, tennis().questions[1]] }, 'eve');
    const result = await arrivals.receive(bad, { userId: 'eve' });
    expect(result.ignored).toBe('grammar');
    expect(await store.get(graphSouls().event(result.arrivalId!))).toMatchObject({ ignored: 'grammar' });
    expect(await arrivals.read(bad.talkId)).toBeUndefined();
    expect(store.souls().some((s) => s.startsWith('local/rev/'))).toBe(false);
  });

  it('stores a received Pair-tag Talk from the responder’s side, apart from the author’s copy', async () => {
    const { store, arrivals } = bob();
    const incoming = offer(phoneDeal(), 'adam');
    await arrivals.receive(incoming, { userId: 'adam' });
    const version = await store.get(graphSouls().event(incoming.versionId));
    const soulKey = (version!.rev as any)['#'].slice('local/rev/'.length);
    expect(soulKey).toMatch(/^[0-9a-f]{64}-r$/);
    const structure = await readTalkStructure(store, soulKey);
    const q1 = await store.get(`local/rev/${soulKey}/q/q_1`);
    expect((q1!.q as any)['#']).toBe(graphSouls().question(questionKeysOf(structure!, 'responder').get('q_1')!));
  });
});

describe('answers and the chatbot (D4: answered by key lookup)', () => {
  it('answers a second Talk with the same situations from Same context, storing no new answer content', async () => {
    const { store, arrivals, answers } = bob();
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    const talkA = (await arrivals.read(a.talkId))!;
    expect((await answers.chatbot(talkA)).pending).toBe('q_0');
    const manual = await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', re: a.versionId,
      steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    expect(await answers.answered(a.talkId)).toBe(manual);

    const b = offer(tennis(['Yes', 'No'], 'Weekend tennis'), 'carol');
    await arrivals.receive(b, { userId: 'carol' });
    const talkB = (await arrivals.read(b.talkId))!;
    const reply = await answers.chatbot(talkB);
    expect(reply).toEqual({ complete: true, answers: [
      { questionId: 'q_0', answerIds: ['a_0_0'], reason: 'same-context' },
      { questionId: 'q_1', answerIds: ['a_1_0'], reason: 'same-context' },
    ] });
    const setSouls = store.souls().filter((s) => s.startsWith('local/s/')).length;
    const auto = await answers.answer({ talkId: b.talkId, structure: talkB, withUser: 'carol', mode: 'chatbot', steps: reply.answers });
    expect(store.souls().filter((s) => s.startsWith('local/s/')).length).toBe(setSouls);
    expect((await store.get(graphSouls().event(auto)))!.gave).toEqual((await store.get(graphSouls().event(manual)))!.gave);
  });

  it('a changed choice set is a new situation; Whenever offered answers it, and the Me tab shows one question twice', async () => {
    const { arrivals, answers } = bob();
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    const talkA = (await arrivals.read(a.talkId))!;
    await answers.answer({ talkId: a.talkId, structure: talkA, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });

    const c = offer(tennis(['Yes', 'No', 'Sometimes']), 'carol');
    await arrivals.receive(c, { userId: 'carol' });
    const talkC = (await arrivals.read(c.talkId))!;
    expect(await answers.chatbot(talkC)).toEqual({ answers: [], pending: 'q_0', complete: false });

    const questionKey = questionKeysOf(talkC, 'responder').get('q_0')!;
    expect(questionKeysOf(talkA, 'responder').get('q_0')).toBe(questionKey); // choices are not part of the question
    await answers.setWhenever(questionKey, ['Sometimes', 'Yes']);
    const reply = await answers.chatbot(talkC);
    // q_0 from Whenever offered; q_1 now follows a different parent answer, so it is a new situation.
    expect(reply).toEqual({ answers: [{ questionId: 'q_0', answerIds: ['a_0_2'], reason: 'whenever-offered' }], pending: 'q_1', complete: false });
    await answers.answer({ talkId: c.talkId, structure: talkC, mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_2'] }, { questionId: 'q_1', answerIds: ['a_1_1'] }] });

    const me = await answers.me();
    expect(me.map((q) => q.text)).toEqual(expect.arrayContaining(['Do you play tennis?', 'How often do you play?']));
    expect(me).toHaveLength(2);
    const played = me.find((q) => q.text === 'Do you play tennis?')!;
    expect(played.contexts).toHaveLength(2);
    const gave = await Promise.all(played.contexts.map((ctx) => answers.gaveTexts(ctx.eventId, ctx.contextHash)));
    expect(gave).toEqual([['Sometimes'], ['Yes']]); // newest first
  });

  it('a shorter Whenever offered list drops the old entries', async () => {
    const { answers } = bob();
    await answers.setWhenever('k', ['Kiwi', 'Apple', 'Pear']);
    await answers.setWhenever('k', ['Apple']);
    const question = { id: 'q', text: 'Fruit?', answers: ['Kiwi', 'Apple', 'Pear'].map((text) => ({ id: text, text })) };
    expect(await answers.lookupWhenever('k', question)).toEqual(['Apple']);
  });

  it('a route fan-out: siblings are independent of answering order; multi-select is remembered as a set', async () => {
    const { arrivals, answers } = bob();
    const deal = offer(phoneDeal(), 'adam');
    await arrivals.receive(deal, { userId: 'adam' });
    const talk = (await arrivals.read(deal.talkId))!;
    const one = situate(talk, [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_1', 'a_1_0'] }, { questionId: 'q_2', answerIds: ['a_2_0'] }], 'responder');
    const two = situate(talk, [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_2', answerIds: ['a_2_0'] }, { questionId: 'q_1', answerIds: ['a_1_0', 'a_1_1'] }], 'responder');
    const byQ = (list: typeof one) => Object.fromEntries(list.map((s) => [s.questionId, s.contextHash]));
    expect(byQ(one)).toEqual(byQ(two));

    await answers.answer({ talkId: deal.talkId, structure: talk, mode: 'manual', steps: one.map((s) => ({ questionId: s.questionId, answerIds: s.questionId === 'q_1' ? ['a_1_0', 'a_1_1'] : s.questionId === 'q_0' ? ['a_0_0'] : ['a_2_0'] })) });
    const again = offer(phoneDeal(), 'dan');
    await arrivals.receive(again, { userId: 'dan' });
    const reply = await answers.chatbot((await arrivals.read(again.talkId))!);
    expect(reply.complete).toBe(true);
    expect(reply.answers.find((a) => a.questionId === 'q_1')!.answerIds!.sort()).toEqual(['a_1_0', 'a_1_1']);
  });

  it('survey questions are independent situations', () => {
    const survey = talkStructureOf({ type: 'survey', language: 'en', questions: [
      { id: 's0', text: 'Coffee?', answers: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
      { id: 's1', text: 'Tea?', answers: [{ id: 'y', text: 'Yes' }, { id: 'n', text: 'No' }] },
    ] });
    const alone = situate(survey, [{ questionId: 's1', answerIds: ['n'] }], 'responder')[0]!.contextHash;
    const after = situate(survey, [{ questionId: 's0', answerIds: ['y'] }, { questionId: 's1', answerIds: ['n'] }], 'responder')[1]!.contextHash;
    expect(after).toBe(alone);
  });

  it('answer event ids are event ids, and the event links the Talk, the person and the answer set', async () => {
    const { store, arrivals, answers } = bob();
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    const id = await answers.answer({ talkId: a.talkId, structure: (await arrivals.read(a.talkId))!, withUser: 'adam', mode: 'manual',
      steps: [{ questionId: 'q_0', answerIds: ['a_0_1'] }] });
    expect(parseEventId(id)).toBeDefined();
    expect(await store.get(graphSouls().event(id))).toMatchObject({
      talk: { '#': graphSouls().event(a.talkId) }, with: { '#': 'local/person/adam' }, mode: 'manual', gave: { '#': expect.stringMatching(/^local\/s\/[0-9a-f]{64}$/) },
    });
  });
});

describe('index rebuild (REQ-GRAPH-02)', () => {
  it('puts back every index from events after a crash lost them, and a second run repairs nothing', async () => {
    const { store, arrivals, answers } = bob();
    let saved: { deviceId?: string; counter?: number } = {};
    const ids = createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(n).fill(3) });
    let clock = Date.UTC(2026, 9, 31, 23);
    const talks = createTalkGraph(store, ids, { now: () => { clock += 3_600_000; return clock; } });
    const mine = await talks.create(tennis(['Yes', 'No'], 'My tennis Talk'));
    await talks.edit(mine, tennis(['Yes', 'No'], 'My tennis Talk, edited'));
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam', link: 'webrtc' });
    await arrivals.receive(a, { userId: 'carol' });
    const talkA = (await arrivals.read(a.talkId))!;
    await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: ['a_1_1'] }] });

    const isIndex = (soul: string) => (soul.startsWith('local/ix/') && !soul.startsWith('local/ix/day')) || soul.startsWith('local/mine/');
    const crashed = memoryNodeStore();
    for (const soul of store.souls()) if (!isIndex(soul)) await crashed.put(soul, (await store.get(soul))!);
    const result = await rebuildIndexes(crashed);
    expect(result.events).toBe(7); // 2 versions of mine, Adam's version, 2 arrivals, 2 answers
    for (const soul of store.souls().filter(isIndex)) {
      const expected = { ...(await store.get(soul))! };
      // State the events cannot imply (active, isTemplate) is not rebuilt.
      if (soul.startsWith('local/mine/talk/')) { delete expected.active; delete expected.isTemplate; }
      expect([soul, await crashed.get(soul)]).toEqual([soul, expected]);
    }
    expect((await rebuildIndexes(crashed)).repaired).toBe(0);
    const rebuiltAnswers = createAnswerGraph(crashed, ids);
    expect((await rebuiltAnswers.me()).map((q) => q.text).sort()).toEqual(['Do you play tennis?', 'How often do you play?']);
    expect(await createTalkGraph(crashed, ids).list()).toEqual([mine]);
  });

  it('a device handoff carries what the chatbot remembers; this device keeps its own answers', async () => {
    const from = bob();
    const a = offer(tennis(['Yes', 'No', 'Sometimes']), 'adam');
    await from.arrivals.receive(a, { userId: 'adam' });
    const talkA = (await from.arrivals.read(a.talkId))!;
    await from.answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_2'], reuse: 'whenever' }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    const rows = await from.answers.remembered();
    expect(rows.map((r) => [r.reuse, r.answerTexts])).toEqual([['auto', ['Weekly']], ['whenever', ['Sometimes']]]);

    // The other device already answered "How often" in that situation (after Sometimes) with
    // Daily, Just once.
    const to = bob();
    await to.arrivals.receive(a, { userId: 'adam' });
    await to.answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_2'] }, { questionId: 'q_1', answerIds: ['a_1_1'], reuse: 'once' }] });
    expect(await to.answers.importRemembered(rows)).toBe(1);
    const after = await to.answers.remembered();
    expect(after.find((r) => r.reuse === 'whenever')?.answerTexts).toEqual(['Sometimes']);
    expect(after.filter((r) => r.questionText === 'How often do you play?').map((r) => [r.reuse, r.answerTexts])).toEqual([['once', ['Daily']]]);
    expect(await to.answers.importRemembered(rows)).toBe(0); // nothing new the second time

    // The crash rebuild keeps what was imported.
    const isIndex = (soul: string) => (soul.startsWith('local/ix/') && !soul.startsWith('local/ix/day')) || soul.startsWith('local/mine/');
    const crashed = memoryNodeStore();
    for (const soul of to.store.souls()) if (!isIndex(soul)) await crashed.put(soul, (await to.store.get(soul))!);
    await rebuildIndexes(crashed);
    const rebuilt = createAnswerGraph(crashed, createEventIdSource({ state: { load: async () => ({}), save: async () => undefined }, randomBytes: (n) => new Uint8Array(n).fill(5) }));
    expect((await rebuilt.remembered()).filter((r) => r.reuse !== 'auto').map((r) => [r.reuse, r.answerTexts]).sort()).toEqual([['once', ['Daily']], ['whenever', ['Sometimes']]]);
  });

  it('restores Whenever offered lists and Preferences changes, in the order they were made', async () => {
    const { store, arrivals, answers } = bob();
    const a = offer(tennis(['Yes', 'No', 'Sometimes']), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    const talkA = (await arrivals.read(a.talkId))!;
    const questionKey = questionKeysOf(talkStructureOf(talkA), 'responder').get('q_0')!;
    // Whenever offered from the dialog, then a Preferences reorder and a removal, then a forget.
    await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: [{ questionId: 'q_0', answerIds: ['a_0_0'], reuse: 'whenever' }, { questionId: 'q_1', answerIds: ['a_1_0'] }] });
    await answers.setWhenever(questionKey, ['Sometimes', 'Yes']);
    await answers.changeRemembered(`whenever|${questionKey}|${(await answers.remembered()).find((r) => r.reuse === 'whenever' && r.answerTexts[0] === 'Yes')!.key.split('|')[2]}`, { forget: true });
    const remembered = await answers.remembered();
    const often = remembered.find((r) => r.reuse !== 'whenever')!;
    await answers.changeRemembered(often.key, { forget: true });
    const before = await answers.remembered();
    expect(before.map((r) => [r.reuse, r.answerTexts])).toEqual([['whenever', ['Sometimes']]]);

    const isIndex = (soul: string) => (soul.startsWith('local/ix/') && !soul.startsWith('local/ix/day')) || soul.startsWith('local/mine/');
    const crashed = memoryNodeStore();
    for (const soul of store.souls()) if (!isIndex(soul)) await crashed.put(soul, (await store.get(soul))!);
    await rebuildIndexes(crashed);
    const rebuilt = createAnswerGraph(crashed, createEventIdSource({ state: { load: async () => ({}), save: async () => undefined }, randomBytes: (n) => new Uint8Array(n).fill(5) }));
    expect((await rebuilt.remembered()).map((r) => [r.reuse, r.answerTexts])).toEqual([['whenever', ['Sometimes']]]);
    expect((await rebuildIndexes(crashed)).repaired).toBe(0);
  });
});

describe('built-in questions and Pair tags in the chatbot (spec §30.2)', () => {
  const pairTalk = (myTag: string, theirTag: string, builtIn: any, title = 'Phone') => ({
    title, type: 'flow', language: 'en', isAdult: false,
    questions: [
      { id: 'q_0', text: myTag, reciprocalTagContext: true, answers: [
        { id: 'a_0_0', text: theirTag, nextQuestionId: 'q_1' },
        { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true },
      ] },
      { id: 'q_1', text: 'Price range', builtIn, answers: [
        { id: 'q_1_compatible', text: 'Compatible', isMatch: true, isTerminal: true },
        { id: 'q_1_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
      ] },
    ],
  });
  const setup = () => {
    const device = bob();
    let saved: { deviceId?: string; counter?: number } = {};
    const ids = createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(n).fill(5) });
    return { ...device, talks: createTalkGraph(device.store, ids) };
  };

  it('my own Talk’s price range answers a counterpart’s Talk: compatible, not compatible, or ask me', async () => {
    const { arrivals, answers, talks } = setup();
    // Bob sells for 100–200: his own Talk declares his range for "Price range" under the sell side.
    await talks.create(pairTalk('Sell', 'Buy', { kind: 'priceRange', priceRange: { min: 100, max: 200 } }));
    const ask = async (builtIn: any, author: string) => {
      const incoming = offer(pairTalk('Buy', 'Sell', builtIn), author);
      await arrivals.receive(incoming, { userId: author });
      return answers.chatbot((await arrivals.read(incoming.talkId))!);
    };
    expect(await ask({ kind: 'priceRange', priceRange: { min: 150, max: 300 } }, 'adam')).toEqual({ complete: true, answers: [
      { questionId: 'q_0', answerIds: ['a_0_0'], reason: 'pair-tag' },
      { questionId: 'q_1', answerIds: ['q_1_compatible'], typed: { kind: 'priceRange', min: 100, max: 200 }, reason: 'built-in' },
    ] });
    expect((await ask({ kind: 'priceRange', priceRange: { min: 500, max: 900 } }, 'carol')).answers[1]!.answerIds).toEqual(['q_1_incompatible']);
    // A time frame is another question kind with no declaration of mine: asked.
    expect((await ask({ kind: 'timeFrame', timeFrame: { start: 1, end: 2 } }, 'dan')).pending).toBe('q_1');
  });

  it('a typed answer I give becomes my declaration, and the crash rebuild restores it', async () => {
    const { store, arrivals, answers } = setup();
    const first = offer(pairTalk('Buy', 'Sell', { kind: 'priceRange', priceRange: { min: 10, max: 20 } }), 'adam');
    await arrivals.receive(first, { userId: 'adam' });
    const talk = (await arrivals.read(first.talkId))!;
    expect((await answers.chatbot(talk)).pending).toBe('q_1');
    await answers.answer({ talkId: first.talkId, structure: talk, mode: 'manual', steps: [
      { questionId: 'q_0', answerIds: ['a_0_0'] },
      { questionId: 'q_1', answerIds: ['q_1_compatible'], typed: { kind: 'priceRange', min: 15, max: 40 } },
    ] });
    const later = offer(pairTalk('Buy', 'Sell', { kind: 'priceRange', priceRange: { min: 30, max: 60 } }), 'carol');
    await arrivals.receive(later, { userId: 'carol' });
    expect((await answers.chatbot((await arrivals.read(later.talkId))!)).answers[1]).toMatchObject({ answerIds: ['q_1_compatible'], reason: 'built-in' });

    const typedSouls = store.souls().filter((s) => s.startsWith('local/ix/typed/'));
    expect(typedSouls).toHaveLength(1);
    const crashed = memoryNodeStore();
    for (const soul of store.souls()) if (!soul.startsWith('local/ix/typed/')) await crashed.put(soul, (await store.get(soul))!);
    await rebuildIndexes(crashed);
    expect(await crashed.get(typedSouls[0]!)).toEqual(await store.get(typedSouls[0]!));
  });

  it('quantity: a sell Talk declares what it has, so mine is what I want', () => {
    expect(builtInCompatible({ kind: 'quantity', quantity: 5 }, { kind: 'quantity', quantity: 3 }, 'Sell')).toBe(true);
    expect(builtInCompatible({ kind: 'quantity', quantity: 2 }, { kind: 'quantity', quantity: 3 }, 'Sell')).toBe(false);
    expect(builtInCompatible({ kind: 'quantity', quantity: 2 }, { kind: 'quantity', quantity: 3 }, 'Buy')).toBe(true);
    expect(builtInCompatible({ kind: 'quantity', quantity: 2 }, { kind: 'quantity', quantity: 3 })).toBeUndefined();
    expect(builtInCompatible({ kind: 'location' }, { kind: 'location' })).toBeUndefined();
  });
});

describe('deleting (owner decision 2026-11-03: deletes propagate to contacts)', () => {
  const crashCopy = async (store: ReturnType<typeof memoryNodeStore>) => {
    const isIndex = (soul: string) => (soul.startsWith('local/ix/') && !soul.startsWith('local/ix/day')) || soul.startsWith('local/mine/');
    const crashed = memoryNodeStore();
    for (const soul of store.souls()) if (!isIndex(soul)) await crashed.put(soul, (await store.get(soul))!);
    return crashed;
  };
  const myIds = () => {
    let saved: { deviceId?: string; counter?: number } = {};
    return createEventIdSource({ state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(n).fill(5) });
  };

  it('my Talk: a deletion event, off my list, not readable, and the rebuild agrees', async () => {
    const { store } = bob();
    const ids = myIds();
    let clock = Date.UTC(2026, 10, 3, 9);
    const talks = createTalkGraph(store, ids, { now: () => { clock += 60_000; return clock; } });
    const keep = await talks.create(tennis(['Yes', 'No'], 'Keep'));
    const gone = await talks.create(tennis(['Yes', 'No'], 'Gone'));
    await talks.edit(gone, tennis(['Yes', 'No'], 'Gone, edited'));
    const deletion = await talks.remove(gone);
    expect(await store.get(graphSouls().event(deletion!))).toMatchObject({ talk: { '#': graphSouls().event(gone) }, deleted: true });
    expect(await talks.list()).toEqual([keep]);
    expect(await talks.read(gone)).toBeUndefined();
    expect(await talks.remove(gone)).toBeUndefined();

    const crashed = await crashCopy(store);
    await rebuildIndexes(crashed);
    expect(await createTalkGraph(crashed, ids).list()).toEqual([keep]);
    expect(await createTalkGraph(crashed, ids).read(gone)).toBeUndefined();
    expect((await rebuildIndexes(crashed)).repaired).toBe(0);
  });

  it('my answer: Same context, the Me tab and "already answered" forget it and the answers it replaced', async () => {
    const { store, arrivals, answers } = bob();
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    const talkA = (await arrivals.read(a.talkId))!;
    const steps = (often: string) => [{ questionId: 'q_0', answerIds: ['a_0_0'] }, { questionId: 'q_1', answerIds: [often] }];
    const first = await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: steps('a_1_0') });
    await answers.answer({ talkId: a.talkId, structure: talkA, withUser: 'adam', mode: 'manual', steps: steps('a_1_1'), replaces: first });
    // Another Talk asking the same first question in the same situation keeps its own answer.
    const b = offer(tennis(['Yes', 'No'], 'Other title'), 'carol');
    await arrivals.receive(b, { userId: 'carol' });
    const deletion = await answers.remove(a.talkId);
    expect(await store.get(graphSouls().event(deletion!))).toMatchObject({ with: { '#': 'local/person/adam' }, deleted: true });
    expect(await answers.answered(a.talkId)).toBeUndefined();
    expect((await answers.chatbot((await arrivals.read(b.talkId))!)).complete).toBe(false);
    expect((await answers.me()).every((q) => q.contexts.length === 0)).toBe(true);

    const crashed = await crashCopy(store);
    await rebuildIndexes(crashed);
    const rebuilt = createAnswerGraph(crashed, myIds());
    expect(await rebuilt.answered(a.talkId)).toBeUndefined();
    expect((await rebuilt.me()).every((q) => q.contexts.length === 0)).toBe(true);
    expect((await rebuildIndexes(crashed)).repaired).toBe(0);
  });

  it('the author deleted a Talk I received: gone from my list, later copies ignored; nobody else may delete it', async () => {
    const { store, arrivals } = bob();
    const a = offer(tennis(), 'adam');
    await arrivals.receive(a, { userId: 'adam' });
    expect(await arrivals.receiveDeletion({ talkId: a.talkId, eventId: `${a.when + 5}-${'c'.repeat(32)}-0`, authorId: 'mallory', when: a.when + 5, device: 'c'.repeat(32) })).toBe(false);
    expect(await arrivals.incoming()).toEqual([a.talkId]);
    expect(await arrivals.receiveDeletion({ talkId: a.talkId, eventId: `${a.when + 9}-${'a'.repeat(32)}-1`, authorId: 'adam', when: a.when + 9, device: 'a'.repeat(32), versionId: a.versionId })).toBe(true);
    expect(await arrivals.incoming()).toEqual([]);
    expect(await arrivals.read(a.talkId)).toBeUndefined();
    expect((await arrivals.receive(a, { userId: 'carol' })).ignored).toBe('deleted');
    expect(await arrivals.incoming()).toEqual([]);

    const crashed = await crashCopy(store);
    await rebuildIndexes(crashed);
    const rebuilt = createArrivalGraph(crashed, myIds());
    expect(await rebuilt.incoming()).toEqual([]);
    expect(await rebuilt.read(a.talkId)).toBeUndefined();
    expect((await rebuildIndexes(crashed)).repaired).toBe(0);
  });
});
