/**
 * A Talk turned away at the receiver's limit is offered again once their minute has room
 * (found by the starter-tags spec under load: a tag or two never arrived, because nothing asked
 * again once the Nearby list stopped changing).
 */
import { DECLINED_RETRY_MS, DECLINED_RETRY_SPREAD_MS, DeclinedRetry } from '../../core/declined-retry';

describe('DeclinedRetry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('offers again to that person after their minute, once however many Talks they turned away', () => {
    const offered: string[] = [];
    const retry = new DeclinedRetry((peer) => offered.push(peer), () => 0);
    retry.declined('ben');
    retry.declined('ben');
    retry.declined('cy');
    jest.advanceTimersByTime(DECLINED_RETRY_MS - 1);
    expect(offered).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(offered).toEqual(['ben', 'cy']);
  });

  it('waits again if they turn a Talk away after the retry', () => {
    const offered: string[] = [];
    const retry = new DeclinedRetry((peer) => offered.push(peer), () => 0.5);
    retry.declined('ben');
    jest.advanceTimersByTime(DECLINED_RETRY_MS + DECLINED_RETRY_SPREAD_MS);
    retry.declined('ben');
    jest.advanceTimersByTime(DECLINED_RETRY_MS + DECLINED_RETRY_SPREAD_MS);
    expect(offered).toEqual(['ben', 'ben']);
  });

  it('spreads senders over a quarter minute and stops with the app', () => {
    const offered: string[] = [];
    const retry = new DeclinedRetry((peer) => offered.push(peer), () => 0.99);
    retry.declined('ben');
    jest.advanceTimersByTime(DECLINED_RETRY_MS + 14_000);
    expect(offered).toEqual([]);
    retry.stop();
    jest.advanceTimersByTime(DECLINED_RETRY_SPREAD_MS);
    expect(offered).toEqual([]);
  });
});
