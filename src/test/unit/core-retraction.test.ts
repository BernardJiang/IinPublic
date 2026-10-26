/** OPEN-91 P4: what a Talk retraction touches. */
import { conversationReferencesTalk, isDealMutuallyConfirmed, planRetractionReceipt, retractionRecipients } from '../../core/retraction';
import { emptyTalkLedgerDoc, retractedKey } from '../../shared/talk-ledger';

const conversations = {
  c1: { otherUserId: 'ann', talkId: 't1' },
  c2: { otherUserId: 'bob', talkId: 'x', relatedTalkIdsJson: JSON.stringify(['t1']) },
  c3: { otherUserId: 'cy', talkId: 'other' },
};

describe('retractions', () => {
  it('a conversation references a Talk directly or through its related Talks', () => {
    expect(conversationReferencesTalk(conversations.c1, 't1')).toBe(true);
    expect(conversationReferencesTalk(conversations.c2, 't1')).toBe(true);
    expect(conversationReferencesTalk({ relatedTalkIds: ['t1'] }, 't1')).toBe(true);
    expect(conversationReferencesTalk({ relatedTalkIdsJson: 'bad' }, 't1')).toBe(false);
    expect(conversationReferencesTalk(conversations.c3, 't1')).toBe(false);
  });

  it('retracting my Talk reaches everyone I matched through it, never myself', () => {
    expect(retractionRecipients({ ...conversations, c4: { otherUserId: 'me', talkId: 't1' } }, 't1', 'me').sort()).toEqual(['ann', 'bob']);
  });

  it('a received retraction is new once, and withdraws the conversation unless the deal was confirmed', () => {
    const base = { talkId: 't1', authorId: 'ann', retractedAt: 100, myId: 'me', conversations, confirmedThisSession: new Set<string>() };
    expect(planRetractionReceipt({ ...base, ledger: emptyTalkLedgerDoc() })).toEqual({ isNew: true, withdraw: true });
    const seen = emptyTalkLedgerDoc();
    seen.retracted[retractedKey('t1', 'ann')] = { retractedAt: 100 } as never;
    expect(planRetractionReceipt({ ...base, ledger: seen }).isNew).toBe(false);
    expect(planRetractionReceipt({ ...base, ledger: seen, retractedAt: 200 }).isNew).toBe(true);
    expect(planRetractionReceipt({ ...base, ledger: seen, confirmedThisSession: new Set(['c1']) }).withdraw).toBe(false);
    const confirmed = { c1: { ...conversations.c1, dealConfirmedByJson: JSON.stringify(['me', 'ann']) } };
    expect(planRetractionReceipt({ ...base, ledger: seen, conversations: confirmed }).withdraw).toBe(false);
    expect(planRetractionReceipt({ ...base, ledger: seen, authorId: 'zed' }).withdraw).toBe(false);
  });

  it('a deal is confirmed only when both have confirmed', () => {
    expect(isDealMutuallyConfirmed({ dealConfirmedByJson: JSON.stringify(['me']) }, 'me', 'ann')).toBe(false);
    expect(isDealMutuallyConfirmed({ dealConfirmedByJson: 'bad' }, 'me', 'ann')).toBe(false);
  });
});
