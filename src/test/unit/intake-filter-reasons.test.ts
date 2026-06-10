import { getDefaultTalkIntakeFilters, intakeFilterRejectReasons, type ReceiverIntakeContext } from '../../shared/talk-intake-filters';

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

  it('returns talk_expired when expiresAt is in the past (number ms)', () => {
    const pastMs = Date.now() - 1000;
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'Old talk', language: 'en', expiresAt: pastMs },
        baseFilters,
      ),
    ).toEqual(['talk_expired']);
  });

  it('returns talk_expired when expiresAt is an ISO string in the past', () => {
    const pastIso = new Date(Date.now() - 5000).toISOString();
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'Old talk', language: 'en', expiresAt: pastIso },
        baseFilters,
      ),
    ).toEqual(['talk_expired']);
  });

  it('does NOT return talk_expired when expiresAt is in the future', () => {
    const futureMs = Date.now() + 86_400_000;
    const reasons = intakeFilterRejectReasons(
      { type: 'flow', title: 'Live talk', language: 'en', expiresAt: futureMs },
      baseFilters,
    );
    expect(reasons).not.toContain('talk_expired');
  });

  it('does NOT return talk_expired when expiresAt is absent', () => {
    const reasons = intakeFilterRejectReasons(
      { type: 'flow', title: 'No expiry', language: 'en' },
      baseFilters,
    );
    expect(reasons).not.toContain('talk_expired');
  });

  it('returns age_gate when talk isAdult and receiverContext.ageVerified is false', () => {
    const ctx: ReceiverIntakeContext = { ageVerified: false };
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'Adult Talk', language: 'en', isAdult: true },
        baseFilters,
        undefined,
        ctx,
      ),
    ).toEqual(['age_gate']);
  });

  it('does NOT return age_gate when talk isAdult but receiverContext.ageVerified is true', () => {
    const ctx: ReceiverIntakeContext = { ageVerified: true };
    const reasons = intakeFilterRejectReasons(
      { type: 'flow', title: 'Adult Talk', language: 'en', isAdult: true },
      baseFilters,
      undefined,
      ctx,
    );
    expect(reasons).not.toContain('age_gate');
  });

  it('does NOT return age_gate when talk is not adult even if receiver is unverified', () => {
    const ctx: ReceiverIntakeContext = { ageVerified: false };
    const reasons = intakeFilterRejectReasons(
      { type: 'flow', title: 'Regular Talk', language: 'en', isAdult: false },
      baseFilters,
      undefined,
      ctx,
    );
    expect(reasons).not.toContain('age_gate');
  });

  it('does NOT return age_gate when receiverContext is absent (age unknown — allow by default)', () => {
    // When no receiverContext is provided, the age gate is not applied (caller did not resolve it).
    const reasons = intakeFilterRejectReasons(
      { type: 'flow', title: 'Adult Talk', language: 'en', isAdult: true },
      baseFilters,
    );
    expect(reasons).not.toContain('age_gate');
  });

  it('returns talk_expired before age_gate (expiry has higher precedence)', () => {
    const pastMs = Date.now() - 1000;
    const ctx: ReceiverIntakeContext = { ageVerified: false };
    expect(
      intakeFilterRejectReasons(
        { type: 'flow', title: 'Expired Adult Talk', language: 'en', isAdult: true, expiresAt: pastMs },
        baseFilters,
        undefined,
        ctx,
      ),
    ).toEqual(['talk_expired']);
  });
});
