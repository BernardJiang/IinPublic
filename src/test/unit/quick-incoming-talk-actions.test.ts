import { quickIgnoreIncomingTalk, quickCopyIncomingTalk } from '../../web/ui/quick-incoming-talk-actions';

const t = (key: string): string => key;

describe('quickIgnoreIncomingTalk', () => {
  function deps(overrides: Partial<Parameters<typeof quickIgnoreIncomingTalk>[2]> = {}) {
    return {
      showNotification: jest.fn(),
      t,
      saveAnswerPreference: jest.fn(),
      completeTalk: jest.fn(),
      emit: jest.fn(),
      ...overrides,
    };
  }

  it('shows an error and resolves nothing when talkId is invalid and there is no identity fallback', () => {
    const d = deps();
    quickIgnoreIncomingTalk('', undefined, d);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotOpen', 'error');
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('requests the full talk by identity when talkId is invalid but a fallback is given', () => {
    const d = deps();
    quickIgnoreIncomingTalk('', 'identity-1', d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalkByIdentity', expect.objectContaining({ identityKey: 'identity-1' }));
  });

  it('requests the full talk by id when talkId is valid', () => {
    const d = deps();
    quickIgnoreIncomingTalk('550e8400-e29b-41d4-a716-446655440000', undefined, d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalk', expect.objectContaining({ talkId: expect.any(String) }));
  });

  it('once the full talk resolves: saves an ignore preference, notifies, and completes the talk as mismatch (withheld)', () => {
    const d = deps();
    quickIgnoreIncomingTalk('', 'identity-1', d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    const fullTalk = { id: 't1', questions: [{ id: 'q1', text: 'Q1' }] };
    callback(fullTalk);

    expect(d.saveAnswerPreference).toHaveBeenCalledWith(
      fullTalk, 't1', fullTalk.questions[0], 'ignore', 'ignore',
      [{ questionId: 'q1', answerText: 'ignore' }],
      'suppressed',
    );
    expect(d.showNotification).toHaveBeenCalledWith('responseTalkIgnored', 'info');
    expect(d.completeTalk).toHaveBeenCalledWith(
      fullTalk,
      [{ questionId: 'q1', answerId: 'ignore', answerText: 'ignore', mode: 'manual' }],
      'mismatch',
      { withholdFromSender: true },
    );
  });

  it('shows an error and does nothing else when the resolved full talk is null', () => {
    const d = deps();
    quickIgnoreIncomingTalk('', 'identity-1', d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    callback(null);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotLoad', 'error');
    expect(d.completeTalk).not.toHaveBeenCalled();
  });

  it('skips saveAnswerPreference (but still completes) when the talk has no questions', () => {
    const d = deps();
    quickIgnoreIncomingTalk('', 'identity-1', d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    callback({ id: 't1', questions: [] });
    expect(d.saveAnswerPreference).not.toHaveBeenCalled();
    expect(d.completeTalk).toHaveBeenCalledWith({ id: 't1', questions: [] }, [], 'mismatch', { withholdFromSender: true });
  });
});

describe('quickCopyIncomingTalk', () => {
  function deps(overrides: Partial<Parameters<typeof quickCopyIncomingTalk>[3]> = {}) {
    return {
      getMyTalks: jest.fn(() => ({} as Record<string, any>)),
      showNotification: jest.fn(),
      t,
      saveMyTalk: jest.fn(),
      refreshTalksList: jest.fn(),
      emit: jest.fn(),
      ...overrides,
    };
  }

  it('shows an info notification and does nothing when already copied', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const d = deps({ getMyTalks: jest.fn(() => ({ [uuid]: { talkId: uuid, title: 'T', type: 'flow', timestamp: '', role: 'copied' } })) as any });
    quickCopyIncomingTalk(uuid, undefined, undefined, d);
    expect(d.showNotification).toHaveBeenCalledWith('talksAlreadyCopied', 'info');
    expect(d.emit).not.toHaveBeenCalled();
  });

  it('requests the full talk when not already copied', () => {
    const d = deps();
    quickCopyIncomingTalk('550e8400-e29b-41d4-a716-446655440000', undefined, undefined, d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalk', expect.objectContaining({ talkId: '550e8400-e29b-41d4-a716-446655440000' }));
  });

  it('once resolved: saves a role:"copied" entry with deduped sender ids from the cluster, notifies, refreshes', () => {
    const d = deps();
    const cluster = { senders: { a: { senderId: 'u1' }, b: { senderId: 'u1' }, c: { senderId: 'u2' } } };
    quickCopyIncomingTalk('550e8400-e29b-41d4-a716-446655440000', undefined, cluster, d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    const fullTalk = { id: 't1', title: 'My Talk', type: 'flow' };
    callback(fullTalk);

    expect(d.saveMyTalk).toHaveBeenCalledWith(
      expect.objectContaining({ talkId: 't1', title: 'My Talk', type: 'flow', role: 'copied', fullTalk, senders: ['u1', 'u2'] }),
    );
    expect(d.showNotification).toHaveBeenCalledWith('talksCopiedToList', 'success');
    expect(d.refreshTalksList).toHaveBeenCalledTimes(1);
  });

  it('omits senders entirely when the cluster has none', () => {
    const d = deps();
    quickCopyIncomingTalk('550e8400-e29b-41d4-a716-446655440000', undefined, undefined, d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    callback({ id: 't1', title: 'T', type: 'flow' });
    const saved = (d.saveMyTalk as jest.Mock).mock.calls[0][0];
    expect(saved.senders).toBeUndefined();
  });

  it('shows an error and does not save when the resolved full talk is null', () => {
    const d = deps();
    quickCopyIncomingTalk('550e8400-e29b-41d4-a716-446655440000', undefined, undefined, d);
    const callback = ((d.emit as jest.Mock).mock.calls[0][1] as any).callback;
    callback(null);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotLoad', 'error');
    expect(d.saveMyTalk).not.toHaveBeenCalled();
  });
});
