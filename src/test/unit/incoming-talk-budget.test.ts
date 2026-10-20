/** Nearby v3 receiving limit: new Talks from strangers per minute (sliding window). */
import { IncomingTalkBudget } from '../../shared/incoming-talk-budget';

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
});
