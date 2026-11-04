// OPEN-106: the Me tab takes each Talk the device graph has from the graph, and keeps the app's
// own record for Talks the graph does not have (still sent as frames) or has not caught up with.

import { mergeGraphAnswerHistory, refreshGraphAnswerHistory, setGraphAnswerHistorySource } from '../../web/ui/graph-answer-history';

const talk = {
  title: 'Tennis partner', type: 'flow', language: 'en',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [{ id: 'a_0_0', text: 'Yes', nextQuestionId: 'q_1' }, { id: 'a_0_1', text: 'No', isIgnore: true, isTerminal: true }] },
    { id: 'q_1', text: 'How often do you play?', answers: [{ id: 'a_1_0', text: 'Weekly', isMatch: true, isTerminal: true }] },
  ],
};
const when = Date.parse('2026-11-03T10:00:00Z');
const graphRecord = {
  appTalkId: 'app-1', when, mode: 'manual', mine: false, withUser: 'adam', talk,
  answers: [
    { questionId: 'q_0', answerId: 'a_0_0', answerText: 'Yes' },
    { questionId: 'q_1', answerId: 'a_1_0', answerText: 'Weekly', isMatch: true },
  ],
};
const appRecord = (talkId: string, answeredAt: number) => ({
  id: `k:${talkId}`, talkId, title: 'Old', type: 'flow', outcome: 'mismatch' as const, answeredAt: new Date(answeredAt).toISOString(), senderIds: [], items: [],
});

afterEach(() => setGraphAnswerHistorySource(null));

describe('Me tab answers from the device graph', () => {
  it('replaces the app record of a Talk the graph has, keeps the rest, and redraws only on change', async () => {
    setGraphAnswerHistorySource(async () => [graphRecord]);
    expect(await refreshGraphAnswerHistory()).toBe(true);
    expect(await refreshGraphAnswerHistory()).toBe(false);
    const merged = Object.values(mergeGraphAnswerHistory({ a: appRecord('app-1', when - 5000), b: appRecord('frames-only', when) }));
    expect(merged.map((r) => r.talkId).sort()).toEqual(['app-1', 'frames-only']);
    const fromGraph = merged.find((r) => r.talkId === 'app-1')!;
    expect(fromGraph).toMatchObject({ title: 'Tennis partner', outcome: 'match', senderIds: ['adam'], answeredAt: new Date(when).toISOString() });
    expect(fromGraph.items.map((i) => [i.prompt, i.choice])).toEqual([['Do you play tennis?', 'Yes'], ['How often do you play?', 'Weekly']]);
  });

  it('an app answer newer than the graph (still being written) wins until the next refresh', async () => {
    setGraphAnswerHistorySource(async () => [graphRecord]);
    await refreshGraphAnswerHistory();
    const merged = Object.values(mergeGraphAnswerHistory({ a: appRecord('app-1', when + 60_000) }));
    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('Old');
  });
});
