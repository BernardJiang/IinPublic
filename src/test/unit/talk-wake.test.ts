import {
  buildTalkWakePayload,
  TALK_WAKE_MIN_INTERVAL_MS,
  TALK_WAKE_PAYLOAD_KIND,
  TalkWakeThrottle,
  talkWakeEnvelopeId,
} from '../../shared/talk-wake';

describe('OPEN-38 Talk wake ping', () => {
  it('carries no Talk content — only the kind, sender and time', () => {
    const payload = buildTalkWakePayload('alice', new Date('2026-10-11T00:00:00Z'));
    expect(payload).toEqual({ kind: TALK_WAKE_PAYLOAD_KIND, senderId: 'alice', at: '2026-10-11T00:00:00.000Z' });
  });

  it('uses one stable envelope id per sender, receiver and window', () => {
    const t = 10 * TALK_WAKE_MIN_INTERVAL_MS;
    expect(talkWakeEnvelopeId('alice', 'bob', t)).toBe(talkWakeEnvelopeId('alice', 'bob', t + TALK_WAKE_MIN_INTERVAL_MS - 1));
    expect(talkWakeEnvelopeId('alice', 'bob', t)).not.toBe(talkWakeEnvelopeId('alice', 'bob', t + TALK_WAKE_MIN_INTERVAL_MS));
    expect(talkWakeEnvelopeId('alice', 'bob', t)).not.toBe(talkWakeEnvelopeId('alice', 'carol', t));
  });

  it('throttles to one ping per receiver per interval and stays bounded', () => {
    const throttle = new TalkWakeThrottle(3);
    expect(throttle.shouldWake('bob', 0)).toBe(true);
    expect(throttle.shouldWake('bob', TALK_WAKE_MIN_INTERVAL_MS - 1)).toBe(false);
    expect(throttle.shouldWake('carol', 1)).toBe(true);
    expect(throttle.shouldWake('bob', TALK_WAKE_MIN_INTERVAL_MS)).toBe(true);
    for (const id of ['d', 'e', 'f']) throttle.shouldWake(id, 2);
    // 'carol' was evicted by the bound, so she may be pinged again (never more often than needed).
    expect(throttle.shouldWake('carol', 3)).toBe(true);
  });
});
