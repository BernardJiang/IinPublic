import { getDefaultTalkIntakeFilters, intakeFilterRejectReasons } from '../../shared/talk-intake-filters';

describe('intakeFilterRejectReasons', () => {
  const baseFilters = getDefaultTalkIntakeFilters(['en']);

  it('returns intake_talk_type when talk type is not allowed', () => {
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'x', language: 'en' },
        { ...baseFilters, allowedTalkTypes: ['tag'] },
      ),
    ).toEqual(['intake_talk_type']);
  });

  it('returns intake_sent_after when talk is older than cutoff', () => {
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'x', language: 'en', updatedAt: '2026-04-20T10:00:00.000Z' },
        { ...baseFilters, sentAfter: '2026-04-25T00:00:00.000Z' },
      ),
    ).toEqual(['intake_sent_after']);
  });

  it('returns intake_language when declared language is not allowed', () => {
    expect(
      intakeFilterRejectReasons({ type: 'flow', title: 'x', language: 'zh' }, baseFilters),
    ).toEqual(['intake_language']);
  });

  it('returns intake_dirty_words when blockDirtyWords is on and content fails', () => {
    expect(
      intakeFilterRejectReasons(
        {
          type: 'flow',
          title: 'Fake bot message',
          language: 'en',
          questions: [{ text: 'spam', answers: [{ text: 'ok' }] }],
        },
        { ...baseFilters, requireGoodGrammar: false, blockDirtyWords: true },
      ),
    ).toEqual(['intake_dirty_words']);
  });

  it('normalizes punctuation/case and recognizes bounded Chinese moderation terms', () => {
    const filters = { ...baseFilters, allowedLanguages: ['en', 'zh'], requireGoodGrammar: false, blockDirtyWords: true };
    expect(
      intakeFilterRejectReasons({ type: 'flow', title: 'This is SCAM!!!', language: 'en' }, filters),
    ).toEqual(['intake_dirty_words']);
    expect(
      intakeFilterRejectReasons({ type: 'flow', title: '这是诈骗信息', language: 'zh' }, filters),
    ).toEqual(['intake_dirty_words']);
    expect(
      intakeFilterRejectReasons({ type: 'flow', title: 'Robotics club meeting', language: 'en' }, filters),
    ).toEqual([]);
  });

  it('returns empty array when subject passes', () => {
    expect(intakeFilterRejectReasons({ type: 'flow', title: 'Hi', language: 'en' }, baseFilters)).toEqual([]);
  });

  it('returns intake_custom_blocked_terms when a custom phrase matches', () => {
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'Win a prize today', language: 'en' },
        { ...baseFilters, customBlockedTerms: ['prize', 'lottery'] },
      ),
    ).toEqual(['intake_custom_blocked_terms']);
  });
});
