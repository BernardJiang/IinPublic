/** @jest-environment jsdom */

import { answerTalksToDelete, deleteMyAnswers, deleteMyTalk, restoreIgnoredTalk, type TalkDeletionDeps } from '../../web/ui/talk-deletion';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import { answeredTalkIdsByContent } from '../../web/ui/answered-talks';
import { getFlatAnswerHistory, setFlatAnswerHistory } from '../../web/ui/answer-history-storage';

const body = { type: 'tag', title: 'T', questions: [{ id: 'q', text: 'T?', answers: [{ id: 'a', text: 'Yes' }] }] };

function deps(overrides: Partial<TalkDeletionDeps> = {}): TalkDeletionDeps {
  return {
    displayTalksList: jest.fn(),
    displayAnswersList: jest.fn(),
    showNotification: jest.fn(),
    t: (key) => key,
    emit: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('restoreIgnoredTalk', () => {
  it('removes the ignored content ledger without sending a network retraction', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'ignored', fullTalk: body, completedAnswers: [{ questionId: 'q', answerId: 'ignore' }] } } as any);
    expect(Object.values(answeredTalkIdsByContent())).toContain('t1');
    const d = deps();

    restoreIgnoredTalk('t1', d);

    expect(getMyTalks().t1).toBeUndefined();
    expect(Object.values(answeredTalkIdsByContent())).not.toContain('t1');
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.showNotification).toHaveBeenCalledWith('talksRestored', 'success');
  });

  it('does nothing when the talk is not ignored', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'copied' } });
    const d = deps();
    restoreIgnoredTalk('t1', d);
    expect(getMyTalks().t1).toBeDefined();
    expect(d.displayTalksList).not.toHaveBeenCalled();
  });

  it('restores the prior retained role when an already-copied talk was ignored', () => {
    setMyTalks({
      t1: {
        talkId: 't1', title: 'T', type: 'flow', timestamp: '', role: 'ignored',
        roleBeforeIgnore: 'copied', completedAnswers: [{ questionId: 'q1', answerId: 'ignore' }],
      },
    });
    restoreIgnoredTalk('t1', deps());
    expect(getMyTalks().t1.role).toBe('copied');
    expect(getMyTalks().t1.completedAnswers).toBeUndefined();
  });
});

describe('deleteMyTalk', () => {
  it('removes the talk entry from myTalks', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'created' } });
    deleteMyTalk('t1', deps());
    expect(getMyTalks().t1).toBeUndefined();
  });

  it('"already answered" follows My Talks: removing an answered tag drops it, others stay', () => {
    const other = { ...body, title: 'Other', questions: [{ id: 'q', text: 'Other?', answers: [{ id: 'a', text: 'Yes' }] }] };
    setMyTalks({
      t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'answered', fullTalk: body, completedAnswers: [{ questionId: 'q', answerId: 'a' }] },
      t2: { talkId: 't2', title: 'Other', type: 'tag', timestamp: '', role: 'answered', fullTalk: other, completedAnswers: [{ questionId: 'q', answerId: 'a' }] },
    } as any);
    deleteMyTalk('t1', deps());
    const answered = Object.values(answeredTalkIdsByContent());
    expect(answered).not.toContain('t1');
    expect(answered).toContain('t2');
  });

  it('refreshes both the talks list and answers list', () => {
    const d = deps();
    deleteMyTalk('t1', d);
    expect(d.displayTalksList).toHaveBeenCalledTimes(1);
    expect(d.displayAnswersList).toHaveBeenCalledTimes(1);
  });

  it('shows a success notification', () => {
    const d = deps();
    deleteMyTalk('t1', d);
    expect(d.showNotification).toHaveBeenCalledWith('talksRemovedFromList', 'success');
  });

  it('emits withdrawTalk and retractTalk with the talkId', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'created' } });
    const d = deps();
    deleteMyTalk('t1', d);
    expect(d.emit).toHaveBeenCalledWith('withdrawTalk', { talkId: 't1' });
    expect(d.emit).toHaveBeenCalledWith('retractTalk', expect.objectContaining({ talkId: 't1' }));
  });

  it('includes a retractedAt timestamp on the retraction', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'created' } });
    const d = deps();
    const before = Date.now();
    deleteMyTalk('t1', d);
    const call = (d.emit as jest.Mock).mock.calls.find(([event]) => event === 'retractTalk');
    expect(call![1].retractedAt).toBeGreaterThanOrEqual(before);
  });

  it('removing an answered Flow copy keeps it answered so the original does not resurface', () => {
    setMyTalks({
      t1: {
        talkId: 't1', title: 'T', type: 'flow', timestamp: '', role: 'copied',
        completedAnswers: [{ questionId: 'q1', answerId: 'a1' }], senders: ['author'],
      },
    });
    setFlatAnswerHistory({
      answer: {
        id: 'answer', talkId: 't1', title: 'T', type: 'flow', outcome: 'match',
        answeredAt: '', senderIds: ['author'], items: [],
      },
    });
    const d = deps();

    deleteMyTalk('t1', d);

    expect(getMyTalks().t1).toBeUndefined();
    expect(Object.keys(getFlatAnswerHistory())).toEqual(['answer']);
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('removing an unanswered Flow copy still clears its local state', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'flow', timestamp: '', role: 'copied' } });
    deleteMyTalk('t1', deps());
    expect(getMyTalks().t1).toBeUndefined();
    expect(Object.values(answeredTalkIdsByContent())).not.toContain('t1');
  });

  it('removes a received tag from Me history without retracting the author\'s network talk', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'copied' } });
    setFlatAnswerHistory({
      answer: {
        id: 'answer', talkId: 't1', title: 'T', type: 'tag', outcome: 'match',
        answeredAt: '', senderIds: ['author'], items: [],
      },
    });
    const d = deps();

    deleteMyTalk('t1', d);

    expect(getFlatAnswerHistory()).toEqual({});
    expect(d.emit).not.toHaveBeenCalledWith('withdrawTalk', expect.anything());
    expect(d.emit).not.toHaveBeenCalledWith('retractTalk', expect.anything());
  });
});

describe('deleteMyAnswers (Me tab: delete my answer)', () => {
  const record = (id: string, talkId: string) => ({ id, talkId, items: [], answeredAt: '2026-11-04T10:00:00.000Z' }) as any;

  it('deletes my answers to Talks I did not create, never touching my own Talk', () => {
    setMyTalks({
      a: { talkId: 'a', title: 'A', type: 'flow', timestamp: '', role: 'answered', completedAnswers: [{ questionId: 'q', answerId: 'x' }] },
      c: { talkId: 'c', title: 'C', type: 'flow', timestamp: '', role: 'copied', completedAnswers: [{ questionId: 'q', answerId: 'x' }], outcome: 'match' },
      mine: { talkId: 'mine', title: 'M', type: 'flow', timestamp: '', role: 'created' },
    } as any);
    setFlatAnswerHistory({ ha: record('ha', 'a'), hc: record('hc', 'c'), hm: record('hm', 'mine') });
    expect(answerTalksToDelete(['a', 'c', 'mine', 'a', ''], getMyTalks())).toEqual(['a', 'c']);

    const d = deps();
    expect(deleteMyAnswers(['a', 'c', 'mine'], d)).toBe(2);

    // The answered Talk leaves my list; the copy I keep stays, without its answers.
    expect(getMyTalks().a).toBeUndefined();
    expect(getMyTalks().c).toMatchObject({ role: 'copied' });
    expect(getMyTalks().c).not.toHaveProperty('completedAnswers');
    expect(getMyTalks().c).not.toHaveProperty('outcome');
    expect(getMyTalks().mine).toBeDefined();
    expect(Object.keys(getFlatAnswerHistory())).toEqual(['hm']);
    expect(answeredTalkIdsByContent()).toEqual({});
    expect(d.showNotification).toHaveBeenCalledWith('meAnswerDeleted', 'success');
  });

  it('does nothing for a row of only my own Talks', () => {
    setMyTalks({ mine: { talkId: 'mine', title: 'M', type: 'flow', timestamp: '', role: 'created' } } as any);
    const d = deps();
    expect(deleteMyAnswers(['mine'], d)).toBe(0);
    expect(d.displayAnswersList).not.toHaveBeenCalled();
  });
});
