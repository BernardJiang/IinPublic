import { quickAnswerIncomingTag, type QuickAnswerIncomingTagDeps } from '../../web/ui/quick-answer-incoming-tag';

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

function deps(overrides: Partial<QuickAnswerIncomingTagDeps> = {}): QuickAnswerIncomingTagDeps {
  return {
    emit: jest.fn(),
    showNotification: jest.fn(),
    t: (key) => key,
    quickCompleteTagTalk: jest.fn(),
    ...overrides,
  };
}

describe('quickAnswerIncomingTag', () => {
  it('demands the full talk by identity when the id is invalid but a fallback identity key exists', () => {
    const d = deps();
    quickAnswerIncomingTag('not-a-real-id', 'identity-key-1', true, d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalkByIdentity', expect.objectContaining({ identityKey: 'identity-key-1' }));
  });

  it('shows an error when the id is invalid and there is no identity fallback', () => {
    const d = deps();
    quickAnswerIncomingTag('not-a-real-id', undefined, true, d);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotOpen', 'error');
  });

  it('demands the full talk by id when valid, passing the identityKeyFallback through', () => {
    const d = deps();
    quickAnswerIncomingTag(VALID_ID, 'fallback-key', true, d);
    expect(d.emit).toHaveBeenCalledWith('demandFullTalk', expect.objectContaining({
      talkId: VALID_ID,
      identityKeyFallback: 'fallback-key',
    }));
  });

  it('completes the tag talk with the checked flag once the full talk arrives', () => {
    const d = deps();
    quickAnswerIncomingTag(VALID_ID, undefined, true, d);
    const call = (d.emit as jest.Mock).mock.calls[0];
    call[1].callback({ id: VALID_ID, title: 'Talk' });
    expect(d.quickCompleteTagTalk).toHaveBeenCalledWith({ id: VALID_ID, title: 'Talk' }, true);
  });

  it('shows an error and does not complete the talk when the full talk lookup fails', () => {
    const d = deps();
    quickAnswerIncomingTag(VALID_ID, undefined, false, d);
    const call = (d.emit as jest.Mock).mock.calls[0];
    call[1].callback(null);
    expect(d.showNotification).toHaveBeenCalledWith('talksCouldNotLoad', 'error');
    expect(d.quickCompleteTagTalk).not.toHaveBeenCalled();
  });
});
