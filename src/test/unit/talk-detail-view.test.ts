/** @jest-environment jsdom */

import { showTalkDetail, type TalkDetailViewDeps } from '../../web/ui/talk-detail-view';
import { setMyTalks, type MyTalkEntry } from '../../web/ui/my-talks-storage';

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

function deps(overrides: Partial<TalkDetailViewDeps> = {}): TalkDetailViewDeps {
  return {
    emit: jest.fn(),
    showTalkResponseDialog: jest.fn(),
    showNotification: jest.fn(),
    t: (key) => key,
    tf: (key, values) => `${key}(${JSON.stringify(values)})`,
    showTalkDetail: jest.fn(),
    ...overrides,
  };
}

function talk(overrides: Partial<MyTalkEntry> = {}): MyTalkEntry {
  return {
    talkId: VALID_ID,
    title: 'My Talk',
    type: 'tag',
    timestamp: new Date().toISOString(),
    role: 'answered',
    fullTalk: { id: VALID_ID, title: 'My Talk' },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('showTalkDetail', () => {
  it('demands the full talk by identity when the id is invalid but a fallback identity key exists', () => {
    const d = deps();
    showTalkDetail('not-a-real-id', 'identity-key-1', undefined, d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalkByIdentity', expect.objectContaining({ identityKey: 'identity-key-1' }));
  });

  it('shows an error when the id is invalid and there is no identity fallback', () => {
    const d = deps();
    showTalkDetail('not-a-real-id', undefined, undefined, d);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotOpen', 'error');
  });

  it('emits loadTalkForEdit for a created talk (not in answer-preview mode)', () => {
    setMyTalks({ [VALID_ID]: talk({ role: 'created' }) });
    const d = deps();
    showTalkDetail(VALID_ID, undefined, undefined, d);
    expect(d.emit).toHaveBeenCalledWith('loadTalkForEdit', { talkId: VALID_ID });
  });

  it('opens the response dialog without auto-answering for an answered/copied talk', () => {
    setMyTalks({ [VALID_ID]: talk({ role: 'answered' }) });
    const d = deps();
    showTalkDetail(VALID_ID, undefined, undefined, d);
    expect(d.showTalkResponseDialog).toHaveBeenCalledWith(
      talk().fullTalk,
      expect.objectContaining({ skipAutoAnswer: true }),
    );
  });

  it('opens the response dialog for a created talk when preferAnswerView is set and fullTalk exists', () => {
    setMyTalks({ [VALID_ID]: talk({ role: 'created' }) });
    const d = deps();
    showTalkDetail(VALID_ID, undefined, { preferAnswerView: true }, d);
    expect(d.showTalkResponseDialog).toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalledWith('loadTalkForEdit', expect.anything());
  });

  it('passes targetQuestionId through to the response dialog when provided', () => {
    setMyTalks({ [VALID_ID]: talk({ role: 'answered' }) });
    const d = deps();
    showTalkDetail(VALID_ID, undefined, { questionId: 'q1' }, d);
    expect(d.showTalkResponseDialog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetQuestionId: 'q1' }),
    );
  });

  it('shows a detail notice for a role with no fullTalk available', () => {
    setMyTalks({ [VALID_ID]: talk({ role: 'answered', fullTalk: undefined }) });
    const d = deps();
    showTalkDetail(VALID_ID, undefined, undefined, d);
    expect(d.showNotification).toHaveBeenCalledWith('talksDetailNotice({"title":"My Talk"})', 'info');
  });

  it('demands the full incoming talk by id when not found locally, and opens the dialog on success', () => {
    const d = deps();
    showTalkDetail(VALID_ID, 'fallback-key', undefined, d);
    const call = (d.emit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('demandFullTalk');
    expect(call[1].talkId).toBe(VALID_ID);
    call[1].callback({ id: VALID_ID, title: 'Incoming' });
    expect(d.showTalkResponseDialog).toHaveBeenCalledWith({ id: VALID_ID, title: 'Incoming' }, expect.objectContaining({ skipAutoAnswer: true }));
  });

  it('offers a retry callback that re-invokes showTalkDetail when the incoming lookup fails', () => {
    const d = deps();
    showTalkDetail(VALID_ID, 'fallback-key', { questionId: 'q1' }, d);
    const call = (d.emit as jest.Mock).mock.calls[0];
    call[1].callback(null);
    expect(d.showNotification).toHaveBeenCalledWith(
      'talksCouldNotLoadRetry',
      'error',
      expect.objectContaining({ retry: expect.any(Function) }),
    );
    const retry = (d.showNotification as jest.Mock).mock.calls[0][2].retry;
    retry();
    expect(d.showTalkDetail).toHaveBeenCalledWith(VALID_ID, 'fallback-key', { questionId: 'q1' });
  });
});
