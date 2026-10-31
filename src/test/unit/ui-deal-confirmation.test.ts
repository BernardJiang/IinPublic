/** @jest-environment jsdom */

import { UIManager } from '../../web/ui/ui-manager';
import { getMyConversations, setMyConversations } from '../../web/ui/my-conversations-storage';

describe('deal confirmation convergence', () => {
  afterEach(() => setMyConversations({}));

  it('keeps both confirmations when a stale peer snapshot arrives later', () => {
    setMyConversations({ c1: { otherUserId: 'peer', dealEligible: true } });
    const ui = new UIManager();

    expect(ui.applyDealConfirmedBy('c1', ['me'])).toEqual(['me']);
    expect(ui.applyDealConfirmedBy('c1', [])).toEqual(['me']);
    expect(ui.applyDealConfirmedBy('c1', ['peer'])).toEqual(['me', 'peer']);
    expect(getMyConversations().c1.dealConfirmedByJson).toBe('["me","peer"]');
  });
});
