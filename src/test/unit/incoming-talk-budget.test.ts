/** Nearby v3 receiving limit: new Talks from strangers per minute (sliding window). */
import { IncomingTalkBudget, PER_SENDER_FACTOR } from '../../shared/incoming-talk-budget';

describe('IncomingTalkBudget', () => {
  it('admits up to the limit in any minute, then again as the window slides', () => {
    const budget = new IncomingTalkBudget(() => 3);
    expect([0, 10_000, 20_000, 30_000].map((t) => budget.tryAdmit(t))).toEqual([true, true, true, false]);
    expect(budget.tryAdmit(59_999)).toBe(false);
    expect(budget.tryAdmit(60_000)).toBe(true);
    expect(budget.tryAdmit(60_001)).toBe(false);
  });

  it('follows a limit changed by a new manifest', () => {
    let limit = 1;
    const budget = new IncomingTalkBudget(() => limit);
    expect(budget.tryAdmit(0)).toBe(true);
    expect(budget.tryAdmit(1)).toBe(false);
    limit = 2;
    expect(budget.tryAdmit(2)).toBe(true);
  });

  it('counts people, not Talks: a newcomer\'s whole batch takes one place (OPEN-114)', () => {
    const budget = new IncomingTalkBudget(() => 2);
    // Alice's first meeting brings 20 Talks at once: one place in the minute.
    expect(Array.from({ length: 20 }, (_, i) => budget.tryAdmitFrom('alice', i))).toEqual(Array(20).fill(true));
    expect(budget.tryAdmitFrom('bob', 100)).toBe(true);
    // The minute's two places are taken: a third newcomer waits for the window.
    expect(budget.tryAdmitFrom('cy', 200)).toBe(false);
    expect(budget.tryAdmitFrom('cy', 60_000)).toBe(true);
  });

  it('one person cannot flood a phone: at most PER_SENDER_FACTOR times the limit in their minute', () => {
    const budget = new IncomingTalkBudget(() => 2);
    const results = Array.from({ length: 2 * PER_SENDER_FACTOR + 1 }, (_, i) => budget.tryAdmitFrom('alice', i));
    expect(results.filter(Boolean)).toHaveLength(2 * PER_SENDER_FACTOR);
    expect(results.at(-1)).toBe(false);
  });
});
