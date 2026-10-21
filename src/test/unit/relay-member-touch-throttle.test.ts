/** OPEN-73: an embedded node rewrites a mirrored room member only when something changed. */
import { RelayMemberTouchThrottle } from '../../server/services/relay-member-touch-throttle';

describe('RelayMemberTouchThrottle', () => {
  const member = { userId: 'eve', stageName: 'Eve', isTraveler: false };

  it('writes a new member, then not again within the refresh window', () => {
    const throttle = new RelayMemberTouchThrottle(60_000);
    expect(throttle.shouldTouch('room', member, 0)).toBe(true);
    expect(throttle.shouldTouch('room', member, 5_000)).toBe(false);
    expect(throttle.shouldTouch('room', member, 59_999)).toBe(false);
    expect(throttle.shouldTouch('room', member, 60_000)).toBe(true);
  });

  it('writes at once when the name or traveler flag changes', () => {
    const throttle = new RelayMemberTouchThrottle(60_000);
    throttle.shouldTouch('room', member, 0);
    expect(throttle.shouldTouch('room', { ...member, stageName: 'Eve 2' }, 1_000)).toBe(true);
    expect(throttle.shouldTouch('room', { ...member, stageName: 'Eve 2', isTraveler: true }, 2_000)).toBe(true);
  });

  it('keeps rooms apart and forgets a member who left', () => {
    const throttle = new RelayMemberTouchThrottle(60_000);
    throttle.shouldTouch('a', member, 0);
    expect(throttle.shouldTouch('b', member, 1_000)).toBe(true);
    throttle.forget('a', 'eve');
    expect(throttle.shouldTouch('a', member, 2_000)).toBe(true);
    throttle.forget('b');
    expect(throttle.shouldTouch('b', member, 3_000)).toBe(true);
  });
});
