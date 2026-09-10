import { deliveryReasonLabel, formatReasonCounts } from '../../web/ui/delivery-reason-labels';

const t = (key: string): string => key;

describe('deliveryReasonLabel', () => {
  it('maps a known reason code to its translation key', () => {
    expect(deliveryReasonLabel('intake_language', t)).toBe('reasonIntakeLanguage');
    expect(deliveryReasonLabel('age_gate', t)).toBe('reasonAgeGate');
  });

  it('maps every rate-limit variant to the same shared reason', () => {
    expect(deliveryReasonLabel('symmetric_rate_limit', t)).toBe('reasonRateLimit');
    expect(deliveryReasonLabel('daily_talk_send_rate_limit', t)).toBe('reasonRateLimit');
    expect(deliveryReasonLabel('weekly_talk_receive_rate_limit', t)).toBe('reasonRateLimit');
  });

  it('falls back to a spaced-out raw code for an unrecognized reason', () => {
    expect(deliveryReasonLabel('some_new_reason', t)).toBe('some new reason');
  });
});

describe('formatReasonCounts', () => {
  it('formats a single reason with its count', () => {
    expect(formatReasonCounts({ age_gate: 3 }, t)).toBe('reasonAgeGate: 3');
  });

  it('joins multiple reasons sorted alphabetically by raw reason code', () => {
    expect(formatReasonCounts({ talk_expired: 1, age_gate: 2 }, t)).toBe('reasonAgeGate: 2 · reasonTalkExpired: 1');
  });

  it('filters out zero and negative counts', () => {
    expect(formatReasonCounts({ age_gate: 0, talk_expired: -1, blocked_user: 5 }, t)).toBe('reasonBlockedUser: 5');
  });

  it('returns an empty string for an empty or all-filtered map', () => {
    expect(formatReasonCounts({}, t)).toBe('');
    expect(formatReasonCounts({ age_gate: 0 }, t)).toBe('');
  });
});
