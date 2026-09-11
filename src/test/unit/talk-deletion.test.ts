/** @jest-environment jsdom */

import { deleteMyTalk, type TalkDeletionDeps } from '../../web/ui/talk-deletion';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import { getAnsweredTalkByContent, setAnsweredTalkByContent } from '../../web/ui/answer-preferences-storage';

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

describe('deleteMyTalk', () => {
  it('removes the talk entry from myTalks', () => {
    setMyTalks({ t1: { talkId: 't1', title: 'T', type: 'tag', timestamp: '', role: 'created' } });
    deleteMyTalk('t1', deps());
    expect(getMyTalks().t1).toBeUndefined();
  });

  it('removes the matching answered-by-content link, if any', () => {
    setAnsweredTalkByContent({ contentKeyA: 't1', contentKeyB: 't2' });
    deleteMyTalk('t1', deps());
    const map = getAnsweredTalkByContent();
    expect(map.contentKeyA).toBeUndefined();
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
    const d = deps();
    deleteMyTalk('t1', d);
    expect(d.emit).toHaveBeenCalledWith('withdrawTalk', { talkId: 't1' });
    expect(d.emit).toHaveBeenCalledWith('retractTalk', expect.objectContaining({ talkId: 't1' }));
  });

  it('includes a retractedAt timestamp on the retraction', () => {
    const d = deps();
    const before = Date.now();
    deleteMyTalk('t1', d);
    const call = (d.emit as jest.Mock).mock.calls.find(([event]) => event === 'retractTalk');
    expect(call![1].retractedAt).toBeGreaterThanOrEqual(before);
  });
});
