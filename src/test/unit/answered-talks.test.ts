/** @jest-environment jsdom */

// OPEN-106: "already answered" by Talk content is derived (My Talks, then the device graph's answer
// history), not a stored map: the same Talk from several senders is one row answered once.

import { answeredTalkIdsByContent, getAnsweredTalkId } from '../../web/ui/answered-talks';
import { getTalkContentKey } from '../../web/ui/answer-history-storage';
import { refreshGraphAnswerHistory, setGraphAnswerHistorySource } from '../../web/ui/graph-answer-history';
import { setMyTalks } from '../../web/ui/my-talks-storage';
import { computeTalkIdFromTalkData } from '../../shared/cid';

const flow = (text: string) => ({ type: 'flow', title: 'F', questions: [{ id: 'q', text, answers: [{ id: 'a', text: 'Yes', isMatch: true }] }] });

afterEach(() => { setGraphAnswerHistorySource(null); setMyTalks({}); });

describe('answered by content', () => {
  it('maps a Talk’s content key and content id to the My Talks entry holding my answer', () => {
    const talk = flow('Tennis?');
    setMyTalks({
      t1: { talkId: 't1', title: 'F', type: 'flow', timestamp: '', role: 'answered', fullTalk: talk, completedAnswers: [{ questionId: 'q', answerId: 'a' }] },
      t2: { talkId: 't2', title: 'F', type: 'flow', timestamp: '', role: 'copied', fullTalk: flow('Chess?') },
    } as any);
    expect(getAnsweredTalkId(getTalkContentKey(talk))).toBe('t1');
    expect(getAnsweredTalkId(computeTalkIdFromTalkData(talk))).toBe('t1');
    expect(Object.values(answeredTalkIdsByContent())).not.toContain('t2'); // a copy never answered
  });

  it('keeps a Talk answered while the graph has my answer, after its copy left My Talks', async () => {
    const talk = flow('Tennis?');
    setGraphAnswerHistorySource(async () => [{
      appTalkId: 'gone', when: Date.UTC(2026, 10, 4), mode: 'manual', mine: false, withUser: 'adam', talk,
      answers: [{ questionId: 'q', answerId: 'a', answerText: 'Yes', isMatch: true }],
    }]);
    expect(getAnsweredTalkId(getTalkContentKey(talk))).toBeUndefined();
    await refreshGraphAnswerHistory();
    expect(getAnsweredTalkId(getTalkContentKey(talk))).toBe('gone');
  });

  it('my own Talk\'s self-answers do not make the same content from someone else answered', async () => {
    const talk = flow('Dating?');
    setGraphAnswerHistorySource(async () => [{
      appTalkId: 'mine', when: Date.UTC(2026, 10, 4), mode: 'manual', mine: true, talk,
      answers: [{ questionId: 'q', answerId: 'a', answerText: 'Yes', isMatch: true }],
    }]);
    await refreshGraphAnswerHistory();
    expect(getAnsweredTalkId(getTalkContentKey(talk))).toBeUndefined();
  });
});
