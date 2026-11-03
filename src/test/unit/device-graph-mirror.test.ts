/** @jest-environment node */

// OPEN-106 phase 4: every `myTalks` write is also written to the device graph, read back and
// compared, without ever failing or slowing the app's own write.

import { createCoreHandler } from '../../core/core-handler';
import { memoryGraphStore } from '../../core/graph-store';
import { memoryNodeStore } from '../../core/device-graph/node-store';
import { graphSouls } from '../../core/device-graph/talk-structure';
import { createAnswerGraph } from '../../core/device-graph/answers';
import { createArrivalGraph } from '../../core/device-graph/arrivals';
import { createTalkGraph } from '../../core/device-graph/talk-events';
import { createEventIdSource } from '../../core/device-graph/event-id';

/* eslint-disable @typescript-eslint/no-explicit-any */

const tennis = (title = 'Tennis partner', authorId = 'me') => ({
  id: 'qa_1234abcd', title, type: 'flow', language: 'en', isAdult: false, authorId, createdAt: '2026-10-30T10:00:00.000Z',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }, { id: 'a_1_1', text: 'Daily', isIgnore: true, isTerminal: true }] },
  ],
});

function device(enabled = true) {
  const nodeStore = memoryNodeStore();
  const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => i + 1);
  const handle = createCoreHandler(memoryGraphStore(), { deviceGraph: { nodeStore, randomBytes: random, enabled } });
  const ids = createEventIdSource({ state: { load: async () => ({}), save: async () => {} }, randomBytes: random });
  const upsert = async (entry: any) => {
    await handle({ name: 'collection.upsert', collection: 'myTalks', entries: { [entry.talkId]: entry } });
    // The handler does not wait for the mirror; wait until its status settles.
    let last = '';
    for (let i = 0; i < 50; i += 1) {
      const status = JSON.stringify(await handle({ name: 'deviceGraph.status' }));
      if (status === last) break;
      last = status;
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return {
    handle, nodeStore, upsert,
    status: () => handle({ name: 'deviceGraph.status' }) as Promise<any>,
    talks: createTalkGraph(nodeStore, ids), arrivals: createArrivalGraph(nodeStore, ids), answers: createAnswerGraph(nodeStore, ids),
    legacyTalk: async (oldId: string) => ((await nodeStore.get(graphSouls().index(`legacy/${encodeURIComponent(oldId)}`)))?.talk as any)?.['#']?.slice('local/ev/'.length) as string,
  };
}

describe('device graph mirror (OPEN-106 phase 4)', () => {
  it('mirrors my Talk once, and a title edit as a new version of the same Talk', async () => {
    const d = device();
    const entry = { talkId: 'qa_1234abcd', title: 'Tennis partner', type: 'flow', timestamp: '2026-10-30T10:00:00.000Z', role: 'created', fullTalk: tennis() };
    await d.upsert(entry);
    await d.upsert({ ...entry, lastInteraction: 'now' }); // the app rewrites entries often
    expect(await d.status()).toMatchObject({ enabled: true, talks: 1, versions: 0, mismatches: 0, errors: 0 });
    const talkId = await d.legacyTalk('qa_1234abcd');
    expect((await d.talks.read(talkId))!.title).toBe('Tennis partner');

    await d.upsert({ ...entry, title: 'Tennis buddy', fullTalk: tennis('Tennis buddy'), disabled: true });
    expect(await d.status()).toMatchObject({ talks: 1, versions: 1, mismatches: 0 });
    expect(await d.talks.read(talkId)).toMatchObject({ title: 'Tennis buddy', active: false });
    expect(await d.talks.history(talkId)).toHaveLength(2);
  });

  it('mirrors a Talk I answered: the author’s Talk, one arrival per sender, and my answers when they change', async () => {
    const d = device();
    const entry = {
      talkId: 'qa_feed0001', title: 'Tennis partner', type: 'flow', timestamp: '2026-10-30T10:00:00.000Z', role: 'answered',
      fullTalk: tennis('Tennis partner', 'adam'), senders: ['adam', 'carol'],
      completedAnswers: [{ questionId: 'q_0', answerId: 'a_0_0', answerText: 'Yes' }, { questionId: 'q_1', answerId: 'a_1_0', answerText: 'Weekly' }],
    };
    await d.upsert(entry);
    await d.upsert(entry);
    expect(await d.status()).toMatchObject({ received: 1, answers: 1, mismatches: 0, errors: 0 });
    const talkId = await d.legacyTalk('qa_feed0001');
    expect(await d.arrivals.read(talkId)).toMatchObject({ senders: ['adam', 'carol'], title: 'Tennis partner' });
    const first = await d.answers.answered(talkId);

    await d.upsert({ ...entry, completedAnswers: [entry.completedAnswers[0], { questionId: 'q_1', answerId: 'a_1_1', answerText: 'Daily' }] });
    expect(await d.status()).toMatchObject({ answers: 2 });
    const second = await d.answers.answered(talkId);
    expect(second).not.toBe(first);
    expect(await d.nodeStore.get(graphSouls().event(second!))).toMatchObject({ replaces: { '#': graphSouls().event(first!) }, with: { '#': 'local/person/adam' } });
    // The Me tab shows both questions; the chatbot now answers this Talk's structure on its own.
    expect((await d.answers.me()).map((q) => q.text).sort()).toEqual(['Do you play tennis?', 'How often do you play?']);
    expect((await d.answers.chatbot((await d.arrivals.read(talkId))!)).complete).toBe(true);
  });

  it('a copied Talk is someone else’s Talk kept in my list, not mine', async () => {
    const d = device();
    await d.upsert({ talkId: 'qa_copy', role: 'copied', fullTalk: tennis('Copied', 'adam'), senders: ['adam'], completedAnswers: [{ questionId: 'q_0', answerId: 'a_0_1' }] });
    expect(await d.status()).toMatchObject({ talks: 0, received: 1, answers: 1, errors: 0 });
    await d.upsert({ talkId: 'qa_ignored', role: 'ignored', fullTalk: tennis('Ignored', 'adam'), completedAnswers: [{ questionId: 'q_0', answerId: 'ignore' }] });
    expect(await d.status()).toMatchObject({ received: 1, answers: 1, errors: 0 });
  });

  it('keeps an old Talk whose text predates the grammar filter', async () => {
    const d = device();
    const old = tennis('tennis', 'adam');
    old.questions[0]!.text = 'do you play tennis';
    await d.upsert({ talkId: 'qa_old', title: 'tennis', type: 'flow', timestamp: '2026-01-01T00:00:00.000Z', role: 'answered', fullTalk: old, completedAnswers: [{ questionId: 'q_0', answerId: 'a_0_1' }] });
    expect(await d.status()).toMatchObject({ received: 1, answers: 1, skipped: 0, errors: 0 });
    expect((await d.arrivals.read(await d.legacyTalk('qa_old')))!.questions[0]!.text).toBe('do you play tennis');
  });

  it('a bad entry is counted, and the app’s own write still succeeds', async () => {
    const d = device();
    const result = await d.handle({ name: 'collection.upsert', collection: 'myTalks', entries: {
      qa_bad: { talkId: 'qa_bad', role: 'answered', fullTalk: tennis('x', 'adam'), completedAnswers: [{ questionId: 'q_9', answerId: 'nope' }] },
    } });
    expect(result).toEqual({ written: 1 });
    await d.upsert({ talkId: 'qa_nofull', role: 'created' });
    expect(await d.status()).toMatchObject({ errors: 1, skipped: 1, lastError: 'no question q_9 in this Talk' });
    expect(await d.handle({ name: 'collection.snapshot', collection: 'myTalks' })).toHaveProperty('qa_bad');
  });

  it('does nothing while the setting is off', async () => {
    const d = device(false);
    await d.upsert({ talkId: 'qa_1234abcd', role: 'created', fullTalk: tennis() });
    expect(await d.status()).toMatchObject({ enabled: false, talks: 0 });
    expect(d.nodeStore.souls()).toEqual([]);
  });

  it('turns on with the deviceGraph setting', async () => {
    const d = device(false);
    await d.handle({ name: 'collection.upsert', collection: 'settings', entries: { deviceGraph: 'true' } });
    await d.upsert({ talkId: 'qa_1234abcd', role: 'created', fullTalk: tennis() });
    expect(await d.status()).toMatchObject({ enabled: true, talks: 1 });
  });

  it('backfill turns the mirror on and mirrors the Talks already on the device, once', async () => {
    const d = device(false);
    await d.handle({ name: 'collection.upsert', collection: 'myTalks', entries: {
      qa_mine: { talkId: 'qa_mine', role: 'created', fullTalk: tennis() },
      qa_theirs: { talkId: 'qa_theirs', role: 'answered', fullTalk: tennis('Theirs', 'adam'), senders: ['adam'], completedAnswers: [{ questionId: 'q_0', answerId: 'a_0_1' }] },
    } });
    expect(await d.status()).toMatchObject({ enabled: false, talks: 0 });
    expect(await d.handle({ name: 'deviceGraph.backfill' })).toEqual({ queued: 2 });
    await d.upsert({ talkId: 'qa_mine', role: 'created', fullTalk: tennis() }); // waits for the queue
    await d.handle({ name: 'deviceGraph.backfill' });
    await d.upsert({ talkId: 'qa_mine', role: 'created', fullTalk: tennis() });
    expect(await d.status()).toMatchObject({ enabled: true, talks: 1, received: 1, answers: 1, mismatches: 0, errors: 0 });
  });
});
