/** @jest-environment node */

// Device graph, first slice (spec §31, OPEN-106): grammar filter, content keys, event ids, a
// Talk's structure as content nodes, Talks as events, bucketed indexes.

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { applyGrammarToTalk, filterText, grammarVersionFor, talkGrammarErrors } from '../../shared/grammar-filter';
import { answerKey, answerSetKey, contextHash, questionKey } from '../../core/device-graph/keys';
import { createEventIdSource, formatEventId, parseEventId } from '../../core/device-graph/event-id';
import { memoryNodeStore } from '../../core/device-graph/node-store';
import {
  graphSouls, questionKeysOf, readTalkStructure, structureRecords, talkStructureKey, talkStructureOf, writeTalkStructure,
} from '../../core/device-graph/talk-structure';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { addToIndex, bucketOf, readIndex, removeFromIndex } from '../../core/device-graph/index-buckets';

/* eslint-disable @typescript-eslint/no-explicit-any */

const flowTalk = (overrides: any = {}) => ({
  id: 'qa_old', title: 'Tennis partner', type: 'flow', language: 'en', isAdult: false, authorId: 'alice',
  createdAt: new Date(0), isTemplate: false, usageCount: 3, tags: [],
  questions: [
    { id: 'q_0', cidId: 'bafy', contextHashId: '', text: 'Do you play tennis?', nextQuestionId: 'q_1', answers: [
      { id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1', isMatch: false },
      { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', contextHashId: 'd61994b8', text: 'How often do you play?', answers: [
      { id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true, counter: 4 },
      { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true },
    ] },
  ],
  ...overrides,
});

const routeTalk = () => ({
  title: 'Phone deal', type: 'route', language: 'en', isAdult: false, matchThreshold: 2, collectionImportance: 'important',
  questions: [
    { id: 'q_0', text: 'Buy', reciprocalTagContext: true, contextPath: [], answers: [
      { id: 'a_0_0', text: 'iPhone', nextQuestionIds: ['q_1', 'q_2'], parallelMatchThreshold: 1 },
      { id: 'a_0_1', text: 'Ignore', isIgnore: true, isTerminal: true },
    ] },
    { id: 'q_1', text: 'Which model?', answerSelectionMode: 'multiple', collectionImportance: 'must-have',
      contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }], answers: [
        { id: 'a_1_0', text: '15', isMatch: true, isTerminal: true },
        { id: 'a_1_1', text: '16', isMatch: true, isTerminal: true },
        { id: 'a_1_2', text: 'Ignore', isIgnore: true, isTerminal: true },
      ] },
    { id: 'q_2', text: 'Price range', builtIn: { kind: 'priceRange', priceRange: { min: 100, max: 200 } },
      contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }], branchingLogic: [{ answerId: 'a_2_0', nextQuestionId: 'q_3' }], answers: [
        { id: 'a_2_0', text: 'Proceed', nextQuestionId: 'q_3' },
        { id: 'a_2_1', text: 'Ignore', isIgnore: true, isTerminal: true },
      ] },
    { id: 'q_3', text: 'Your age range', builtIn: { kind: 'ageRange', ageRange: { age: 30, acceptableRange: { min: 25, max: 40 } } },
      isAgeGate: true, contextPath: [{ questionId: 'q_0', answerId: 'a_0_0' }, { questionId: 'q_2', answerId: 'a_2_0' }], answers: [
        { id: 'a_3_0', text: 'Proceed', isMatch: true, isTerminal: true },
        { id: 'a_3_1', text: 'Ignore', isIgnore: true, isTerminal: true },
      ] },
  ],
});

const surveyTalk = () => ({
  title: 'Weekend habits', type: 'survey', language: 'zh', isAdult: false,
  questions: [
    { id: 'q_0', text: '你打网球吗？', isAggregatable: true, answers: [{ id: 'a0', text: '是', counter: 9 }, { id: 'a1', text: '不' }] },
    { id: 'q_1', text: '你多久打一次？', isAggregatable: true, answers: [{ id: 'b0', text: '每周' }, { id: 'b1', text: '每天' }] },
  ],
});

const tagTalk = () => ({
  title: 'Tennis', type: 'tag', language: 'en', isAdult: false,
  questions: [{ id: 'q_0', text: 'Tennis', tagKind: 'simple', answers: [
    { id: 'a_0', text: 'Tennis', isMatch: true, isTerminal: true },
    { id: 'a_1', text: 'Ignore', isIgnore: true, isTerminal: true },
  ] }],
});

describe('grammar filter (spec §31.3a)', () => {
  it.each([
    [' Do  you play tennis? ', 'Do you play tennis?'],
    ['Do you play tennis ?', 'Do you play tennis?'],
    ['Do you play tennis？', 'Do you play tennis?'],
    ['Tennis??', 'Tennis?'],
    ['Do you play tennis', 'Do you play tennis?'],
    ['do you play tennis?', 'Do you play tennis?'],
    ['iPhone model?', 'iPhone model?'],
    ['Do you play tenis?', 'Do you play tenis?'],
  ])('en-v1 question %j → %j', (input, output) => {
    expect(filterText(input, 'en', 'question')).toBe(output);
    expect(filterText(output, 'en', 'question')).toBe(output); // idempotent
  });

  it('en-v1 choices get spacing and capitals but never a question mark', () => {
    expect(filterText('Tennis,golf', 'en', 'choice')).toBe('Tennis, golf');
    expect(filterText('weekly', 'en', 'choice')).toBe('Weekly');
    expect(filterText('10:30', 'en', 'choice')).toBe('10:30');
  });

  it.each([
    [' 你打网球吗？ ', '你打网球吗？'],
    ['你 打网球吗？', '你打网球吗？'],
    ['你打网球吗?', '你打网球吗？'],
    ['你好 ， 打网球吗？', '你好，打网球吗？'],
    ['你打网球吗？？', '你打网球吗？'],
    ['你打网球吗', '你打网球吗？'],
    ['用 iPhone 吗？', '用 iPhone 吗？'],
    ['用iPhone吗？', '用iPhone吗？'],
  ])('zh-v1 question %j → %j', (input, output) => {
    expect(filterText(input, 'zh', 'question')).toBe(output);
    expect(filterText(output, 'zh', 'question')).toBe(output);
  });

  it('other languages are used exactly as written', () => {
    expect(grammarVersionFor('es')).toBeUndefined();
    expect(filterText(' ¿juegas  al tenis ', 'es', 'question')).toBe(' ¿juegas  al tenis ');
    expect(talkGrammarErrors({ language: 'es', questions: [{ text: 'tenis', answers: [{ text: 'sí' }] }] })).toEqual([]);
  });

  it('a tag keeps its name: no question mark, and a simple tag still matches itself', () => {
    const fixed = applyGrammarToTalk({ ...tagTalk(), questions: [{ ...tagTalk().questions[0], text: 'tennis', answers: [{ id: 'a_0', text: 'tennis' }] }] });
    expect(fixed.questions[0].text).toBe('Tennis');
    expect(fixed.questions[0].answers[0].text).toBe('Tennis');
  });

  it('a receiver sees every text the filter would change', () => {
    const errors = talkGrammarErrors(flowTalk({ questions: [{ id: 'q_0', text: 'do you play tennis', answers: [{ id: 'a', text: 'yes' }] }] }));
    expect(errors).toEqual([
      { questionId: 'q_0', text: 'do you play tennis', corrected: 'Do you play tennis?' },
      { questionId: 'q_0', answerId: 'a', text: 'yes', corrected: 'Yes' },
    ]);
    expect(talkGrammarErrors(flowTalk())).toEqual([]);
    expect(talkGrammarErrors(routeTalk())).toEqual([]);
    expect(talkGrammarErrors(surveyTalk())).toEqual([]);
  });
});

describe('content keys (spec §31.3)', () => {
  it('are full-length SHA-256 and exact', () => {
    const key = questionKey({ text: 'Do you play tennis?', language: 'en' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(questionKey({ text: 'do you play tennis?', language: 'en' })).not.toBe(key);
    expect(questionKey({ text: 'Do you play tennis?', language: 'zh' })).not.toBe(key);
    expect(questionKey({ text: 'Do you play tennis?', language: 'EN' })).toBe(key);
    expect(questionKey({ text: 'Do you play tennis?', language: 'en', selection: 'multiple' })).not.toBe(key);
    expect(questionKey({ text: 'Do you play tennis?', language: 'en', selfTag: 'Buy', counterpartTag: 'iPhone' })).not.toBe(key);
    expect(answerKey('Yes')).not.toBe(answerKey('yes'));
  });

  it('a context hash changes with the choice set and built-in values (D13), not choice order', () => {
    const base = { type: 'flow', language: 'en', question: 'Price?', choices: ['Proceed', 'Ignore'] };
    const hash = contextHash(base);
    expect(contextHash({ ...base, choices: ['Ignore', 'Proceed'] })).toBe(hash);
    expect(contextHash({ ...base, choices: ['Proceed', 'Ignore', 'Maybe'] })).not.toBe(hash);
    expect(contextHash({ ...base, builtIn: { kind: 'priceRange', min: 100, max: 200 } }))
      .not.toBe(contextHash({ ...base, builtIn: { kind: 'priceRange', min: 500, max: 900 } }));
    const parent = { contextHash: hash, answers: ['a', 'b'] };
    expect(contextHash({ ...base, parent })).toBe(contextHash({ ...base, parent: { contextHash: hash, answers: ['b', 'a'] } }));
    expect(contextHash({ ...base, parent })).not.toBe(hash);
    // A survey question is independent: its parent never counts.
    expect(contextHash({ ...base, type: 'survey', parent })).toBe(contextHash({ ...base, type: 'survey' }));
  });

  it('an answer set does not depend on the order of choices', () => {
    expect(answerSetKey({ c1: { choices: ['x', 'y'] } })).toBe(answerSetKey({ c1: { choices: ['y', 'x'] } }));
    expect(answerSetKey({ c1: { choices: ['x'] } })).not.toBe(answerSetKey({ c1: { choices: ['y'] } }));
  });
});

describe('event ids (REQ-GRAPH-23)', () => {
  const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 1);

  it('format and parse', () => {
    const id = formatEventId({ when: 1762041600000, deviceId: '0123456789abcdef0123456789abcdef', counter: 46 });
    expect(id).toBe('1762041600000-0123456789abcdef0123456789abcdef-1a');
    expect(parseEventId(id)).toEqual({ when: 1762041600000, deviceId: '0123456789abcdef0123456789abcdef', counter: 46 });
    expect(parseEventId('qa_1234')).toBeUndefined();
  });

  it('two events in one millisecond differ, and a restart never reuses a counter', async () => {
    let saved: { deviceId?: string; counter?: number } = {};
    const state = { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } };
    const first = createEventIdSource({ state, now: () => 1762041600000, randomBytes: bytes, block: 4 });
    const ids = await Promise.all([first.next(), first.next(), first.next(), first.next(), first.next()]);
    expect(new Set(ids).size).toBe(5);
    expect(ids.map((id) => parseEventId(id)!.counter)).toEqual([0, 1, 2, 3, 4]);
    // Killed here: the second block (4..7) was reserved, so a new process starts at 8.
    const second = createEventIdSource({ state, now: () => 1762041600000, randomBytes: () => new Uint8Array(16), block: 4 });
    const after = parseEventId(await second.next())!;
    expect(after.counter).toBe(8);
    expect(after.deviceId).toBe(parseEventId(ids[0]!)!.deviceId);
  });
});

describe('a Talk structure as content nodes (spec §31.4)', () => {
  it.each([
    ['flow', flowTalk()],
    ['route with fan-out, built-ins, multi-select and a Pair tag', routeTalk()],
    ['survey', surveyTalk()],
    ['simple tag', tagTalk()],
  ])('%s reads back equal to its structure', async (_name, talk) => {
    const store = memoryNodeStore();
    const { revKey } = await writeTalkStructure(store, talk, { perspective: 'author', now: 1 });
    expect(revKey).toBe(talkStructureKey(talkStructureOf(talk)));
    expect(await readTalkStructure(store, revKey)).toEqual(talkStructureOf(talk));
  });

  it('drops what is not structure: counters, retired ids, title and author', () => {
    const structure = talkStructureOf(flowTalk());
    expect(JSON.stringify(structure)).not.toMatch(/counter|cidId|contextHashId|Tennis partner|alice|usageCount/);
    expect(structure.questions[0].answers[0]).toEqual({ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' });
  });

  it('keeps question and choice text only in q/ and a/ nodes, once each', async () => {
    const store = memoryNodeStore();
    const talk = flowTalk({ questions: [...flowTalk().questions, { id: 'q_2', text: 'Do you play tennis?', answers: [{ id: 'x', text: 'Yes' }] }] });
    await writeTalkStructure(store, talk, { perspective: 'author', now: 1 });
    const holders: Record<string, string[]> = {};
    for (const soul of store.souls()) {
      const node = JSON.stringify(await store.get(soul));
      for (const text of ['Do you play tennis?', 'Yes', 'Weekly']) if (node.includes(`"${text}"`)) (holders[text] ||= []).push(soul.split('/')[1]!);
    }
    expect(holders).toEqual({ 'Do you play tennis?': ['q'], Yes: ['a'], Weekly: ['a'] });
  });

  it('writes nothing for a structure already stored, and shares one rev/ between identical Talks', async () => {
    const store = memoryNodeStore();
    const first = await writeTalkStructure(store, flowTalk(), { perspective: 'author', now: 1 });
    const writes = store.writes;
    const second = await writeTalkStructure(store, flowTalk({ title: 'Another title', authorId: 'bob' }), { perspective: 'author', now: 2 });
    expect(second).toEqual({ revKey: first.revKey, soulKey: first.soulKey, written: 0 });
    expect(store.writes).toBe(writes);
  });

  it('a choice or price-range edit is a new structure; reused text is not rewritten', async () => {
    const store = memoryNodeStore();
    const original = await writeTalkStructure(store, routeTalk(), { perspective: 'author', now: 1 });
    const repriced = routeTalk();
    repriced.questions[2]!.builtIn = { kind: 'priceRange', priceRange: { min: 500, max: 900 } };
    const edited = await writeTalkStructure(store, repriced, { perspective: 'author', now: 2 });
    expect(edited.revKey).not.toBe(original.revKey);
    const questionText = await store.get(graphSouls().question(questionKeysOf(talkStructureOf(repriced), 'author').get('q_1')!));
    expect(questionText?.firstSeen).toBe(1);
  });

  it('a Pair tag is read from the reader’s side: the author’s self tag is the responder’s counterpart', () => {
    const structure = talkStructureOf(routeTalk());
    const author = questionKeysOf(structure, 'author').get('q_1');
    const responder = questionKeysOf(structure, 'responder').get('q_1');
    expect(author).toBe(questionKey({ text: 'Which model?', language: 'en', selection: 'multiple', selfTag: 'Buy', counterpartTag: 'iPhone' }));
    expect(responder).toBe(questionKey({ text: 'Which model?', language: 'en', selection: 'multiple', selfTag: 'iPhone', counterpartTag: 'Buy' }));
    // The Pair-tag question itself has no ancestor, so no scope.
    expect(questionKeysOf(structure, 'author').get('q_0')).toBe(questionKeysOf(structure, 'responder').get('q_0'));
  });

  it('a write cut short is completed by the next write of the same structure', async () => {
    const store = memoryNodeStore();
    const records = structureRecords(flowTalk(), { perspective: 'author', now: 1 });
    // The app was killed mid-flush: the root and most nodes landed, one did not.
    for (const [soul, node] of [...records.text, ...records.nodes.slice(1), records.root]) await store.put(soul, node);
    expect(await readTalkStructure(store, records.revKey)).toBeUndefined();
    const again = await writeTalkStructure(store, flowTalk(), { perspective: 'author', now: 2 });
    expect(again.written).toBe(1);
    expect(await readTalkStructure(store, records.revKey)).toEqual(talkStructureOf(flowTalk()));
  });

  it('a structure missing a node reads as not stored', async () => {
    const store = memoryNodeStore();
    const records = structureRecords(flowTalk(), { perspective: 'author', now: 1 });
    for (const [soul, node] of [...records.text, ...records.nodes.slice(1), records.root]) await store.put(soul, node);
    expect(await readTalkStructure(store, records.revKey)).toBeUndefined();
  });
});

describe('Talks as events (spec §31.5, D14)', () => {
  const setup = () => {
    let clock = Date.UTC(2026, 9, 30, 12);
    let saved: { deviceId?: string; counter?: number } = {};
    const ids = createEventIdSource({
      state: { load: async () => saved, save: async (s: { deviceId: string; counter: number }) => { saved = { ...s }; } },
      now: () => clock, randomBytes: (n) => new Uint8Array(n).fill(171),
    });
    const store = memoryNodeStore();
    return { store, talks: createTalkGraph(store, ids, { now: () => clock }), tick: (ms: number) => { clock += ms; } };
  };

  it('a Talk is the event that wrote it; an edit is a new version of the same Talk', async () => {
    const { store, talks, tick } = setup();
    const talkId = await talks.create(flowTalk());
    expect(parseEventId(talkId)).toBeDefined();
    const created = await talks.read(talkId);
    expect(created).toMatchObject({ id: talkId, title: 'Tennis partner', type: 'flow', active: true, isTemplate: false, versionId: talkId });
    expect(created!.questions).toEqual(talkStructureOf(flowTalk()).questions);

    tick(60_000);
    const retitled = await talks.edit(talkId, flowTalk({ title: 'Tennis buddy', expiresAt: 1800000000000 }));
    const afterTitle = await talks.read(talkId);
    expect(afterTitle).toMatchObject({ id: talkId, title: 'Tennis buddy', expiresAt: 1800000000000, versionId: retitled, createdAt: created!.createdAt });
    expect(afterTitle!.updatedAt).toBe(created!.createdAt + 60_000);
    const retitledEvent = await store.get(graphSouls().event(retitled));
    const firstEvent = await store.get(graphSouls().event(talkId));
    expect(retitledEvent?.rev).toEqual(firstEvent?.rev); // a title edit keeps the structure
    expect(retitledEvent?.talk).toEqual({ '#': graphSouls().event(talkId) });

    tick(60_000);
    const rechoiced = flowTalk();
    rechoiced.questions[1]!.answers.push({ id: 'a_1_2', text: 'Monthly', isIgnore: true, isTerminal: true } as any);
    const third = await talks.edit(talkId, rechoiced);
    expect((await store.get(graphSouls().event(third)))?.rev).not.toEqual(firstEvent?.rev);
    expect(await talks.history(talkId)).toEqual([third, retitled, talkId]);
    expect((await talks.read(talkId))!.questions[1]!.answers.map((a) => a.text)).toEqual(['Weekly', 'Daily', 'Monthly']);
  });

  it('lists my Talks newest first, one bucket per month', async () => {
    const { store, talks, tick } = setup();
    const october = await talks.create(flowTalk());
    tick(3 * 24 * 3600_000); // into November
    const november = await talks.create(tagTalk());
    await talks.setState(october, { active: false });
    expect(await talks.list()).toEqual([november, october]);
    expect(await talks.list({ months: 1 })).toEqual([november]);
    expect(Object.keys((await store.get(graphSouls().index('mine-talks')))!).sort()).toEqual(['2026-10', '2026-11']);
    expect((await talks.read(october))!.active).toBe(false);
  });
});

describe('bucketed indexes', () => {
  it('splits by month or day and skips removed entries', async () => {
    const store = memoryNodeStore();
    const soul = 'local/ix/person/pub1/ev';
    const t = (d: number) => Date.UTC(2026, 10, d, 9);
    await addToIndex(store, soul, { key: 'e1', target: 'local/ev/e1', when: t(1) }, 'day');
    await addToIndex(store, soul, { key: 'e2', target: 'local/ev/e2', when: t(2) }, 'day');
    await addToIndex(store, soul, { key: 'e3', target: 'local/ev/e3', when: t(2) }, 'day');
    await removeFromIndex(store, soul, { key: 'e2', when: t(2) }, 'day');
    expect(bucketOf(t(2), 'month')).toBe('2026-11');
    expect(await readIndex(store, soul)).toEqual([
      { key: 'e3', target: 'local/ev/e3', bucket: '2026-11-02' },
      { key: 'e1', target: 'local/ev/e1', bucket: '2026-11-01' },
    ]);
    expect((await readIndex(store, soul, { from: '2026-11-02' })).map((e) => e.key)).toEqual(['e3']);
  });
});

// Real Gun + Radisk on disk, in a child Node process (as on the phone): Gun acknowledges a write
// only once storage has it, and a second instance on the same folder reads from disk only.
const DISK_SCRIPT = `
console.log = () => {};
const Gun = require('gun');
const { gunNodeStore } = require('./src/core/device-graph/node-store');
const { createEventIdSource } = require('./src/core/device-graph/event-id');
const { createTalkGraph } = require('./src/core/device-graph/talk-events');
const [dir, talkJson] = [process.argv[2], process.argv[3]];
const open = () => Gun({ file: dir, peers: [], multicast: false, axe: false, localStorage: false, WebSocket: function () {} });
let saved = {};
const ids = () => createEventIdSource({ state: { load: async () => saved, save: async (s) => { saved = { ...s }; } }, randomBytes: (n) => new Uint8Array(n).fill(7) });
(async () => {
  const writer = open();
  const talkId = await createTalkGraph(gunNodeStore(writer, { missWaitMs: 0 }), ids()).create(JSON.parse(talkJson));
  await new Promise((r) => setTimeout(r, 300));
  const reader = open();
  const talk = await createTalkGraph(gunNodeStore(reader, { missWaitMs: 300 }), ids()).read(talkId);
  process.stdout.write(JSON.stringify({ talkId, talk, parents: ['local/q', 'local/a', 'local/ev', 'local/rev'].filter((s) => reader._.graph[s] || writer._.graph[s]) }));
  process.exit(0);
})().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.stack || e) })); process.exit(1); });
`;

describe('on real Gun with Radisk on disk', () => {
  it('a Talk written by one instance reads back whole from disk in another', () => {
    const root = path.resolve(__dirname, '../../..');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iinpublic-graph-'));
    const script = path.join(root, `.device-graph-probe-${process.pid}.cts`);
    fs.writeFileSync(script, DISK_SCRIPT);
    try {
      const out = execFileSync(path.join(root, 'node_modules/.bin/tsx'), [script, path.join(dir, 'radata'), JSON.stringify(routeTalk())], {
        cwd: root, encoding: 'utf8', timeout: 60_000,
      });
      const result = JSON.parse(out);
      expect(result.error).toBeUndefined();
      expect(result.talk.questions).toEqual(talkStructureOf(routeTalk()).questions);
      expect(result.talk).toMatchObject({ id: result.talkId, title: 'Phone deal', matchThreshold: 2 });
      expect(result.parents).toEqual([]); // no content soul was linked into a growing parent node
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(script, { force: true });
    }
  }, 90_000);
});
