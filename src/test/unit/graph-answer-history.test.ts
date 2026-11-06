// OPEN-106: the device graph's answers as Me-tab records, one per Talk. How they combine with the
// page's own records (newer ones, deleted Talks) is answer-history-storage.test.ts's.

import { graphHistoryRecords, refreshGraphAnswerHistory, setGraphAnswerHistorySource } from '../../web/ui/graph-answer-history';

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

afterEach(() => setGraphAnswerHistorySource(null));

describe('Me tab answers from the device graph', () => {
  it('reads one record per Talk from the graph, and redraws only on change', async () => {
    setGraphAnswerHistorySource(async () => [graphRecord]);
    expect(await refreshGraphAnswerHistory()).toBe(true);
    expect(await refreshGraphAnswerHistory()).toBe(false);
    const [fromGraph] = graphHistoryRecords();
    expect(fromGraph).toMatchObject({ talkId: 'app-1', title: 'Tennis partner', outcome: 'match', senderIds: ['adam'], answeredAt: new Date(when).toISOString() });
    expect(fromGraph!.items.map((i) => [i.prompt, i.choice])).toEqual([['Do you play tennis?', 'Yes'], ['How often do you play?', 'Weekly']]);
  });
});
