import {
  formatTalkExpiryTone,
  getIncomingQuestionCount,
} from '../../web/ui/talk-list-metadata';

describe('formatTalkExpiryTone', () => {
  const now = Date.parse('2026-09-11T12:00:00.000Z');

  it('returns neutral when expiry is absent or invalid', () => {
    expect(formatTalkExpiryTone(undefined, now)).toBe('neutral');
    expect(formatTalkExpiryTone('not-a-date', now)).toBe('neutral');
  });

  it('returns red for expired talks and talks with at most two hours left', () => {
    expect(formatTalkExpiryTone(now - 1, now)).toBe('red');
    expect(formatTalkExpiryTone(now + 2 * 60 * 60 * 1000, now)).toBe('red');
  });

  it('returns amber for talks with at most one day left', () => {
    expect(formatTalkExpiryTone(now + 2 * 60 * 60 * 1000 + 1, now)).toBe('amber');
    expect(formatTalkExpiryTone(now + 24 * 60 * 60 * 1000, now)).toBe('amber');
  });

  it('returns green for talks with more than one day left and accepts ISO strings', () => {
    expect(formatTalkExpiryTone(now + 24 * 60 * 60 * 1000 + 1, now)).toBe('green');
    expect(formatTalkExpiryTone('2026-09-13T12:00:00.000Z', now)).toBe('green');
  });
});

describe('getIncomingQuestionCount', () => {
  it('prefers a positive explicit count and floors fractional values', () => {
    expect(getIncomingQuestionCount({
      questionCount: '3.9',
      latestTalk: { questions: [{}, {}] },
      questionsJson: '[{}]',
    })).toBe(3);
  });

  it('falls back to the latest talk questions', () => {
    expect(getIncomingQuestionCount({ questionCount: 0, latestTalk: { questions: [{}, {}] } })).toBe(2);
  });

  it('falls back to serialized questions', () => {
    expect(getIncomingQuestionCount({ questionsJson: '[{"id":"q1"},{"id":"q2"}]' })).toBe(2);
  });

  it('returns zero for malformed or non-array serialized questions', () => {
    expect(getIncomingQuestionCount({ questionsJson: '{"id":"q1"}' })).toBe(0);
    expect(getIncomingQuestionCount({ questionsJson: 'not-json' })).toBe(0);
    expect(getIncomingQuestionCount(null)).toBe(0);
  });
});
