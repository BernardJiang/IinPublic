/** @jest-environment jsdom */

import { deleteMyTalk, restoreIgnoredTalk, type TalkDeletionDeps } from '../../web/ui/talk-deletion';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import {
  getAnsweredTalkByContent,
  getAnswerPreferences,
  getFlattenedAnswerPreferences,
  setAnsweredTalkByContent,
  setAnswerPreferences,
  setFlattenedAnswerPreferences,
} from '../../web/ui/answer-preferences-storage';
import { getFlatAnswerHistory, setFlatAnswerHistory } from '../../web/ui/answer-history-storage';

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
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'ignored' } });
    setAnsweredTalkByContent({ content: 't1' });
    const d = deps();

    restoreIgnoredTalk('t1', d);

    expect(getMyTalks().t1).toBeUndefined();
    expect(getAnsweredTalkByContent().content).toBeUndefined();
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

  it('removes the matching answered-by-content link, if any', () => {
    setAnsweredTalkByContent({ contentKeyA: 't1', contentAliasA: 't1', contentKeyB: 't2' });
    deleteMyTalk('t1', deps());
    const map = getAnsweredTalkByContent();
    expect(map.contentKeyA).toBeUndefined();
    expect(map.contentAliasA).toBeUndefined();
    expect(map.contentKeyB).toBe('t2');
  });

  it('is a no-op on the answered-by-content map when nothing points at this talkId', () => {
    setAnsweredTalkByContent({ contentKeyA: 'other-talk' });
    deleteMyTalk('t1', deps());
    expect(getAnsweredTalkByContent().contentKeyA).toBe('other-talk');
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

  it('removes temporary answer-preference aliases learned from the unchecked tag', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'copied' } });
    setAnswerPreferences({
      regular: { answerId: 'yes', answerText: 'Yes', mode: 'temporary', talkId: 't1', flatKey: 'flat_t1' },
      keep: { answerId: 'yes', answerText: 'Yes', mode: 'temporary', talkId: 't2' },
    });
    setFlattenedAnswerPreferences({
      flat_t1: { answerId: 'yes', answerText: 'Yes', mode: 'temporary', talkId: 't1', flatKey: 'flat_t1' },
    });

    deleteMyTalk('t1', deps());

    expect(getAnswerPreferences().regular).toBeUndefined();
    expect(getAnswerPreferences().keep).toBeDefined();
    expect(getFlattenedAnswerPreferences().flat_t1).toBeUndefined();
  });
});
