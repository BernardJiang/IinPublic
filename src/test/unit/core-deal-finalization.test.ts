/** OPEN-91 P4: what a mutually confirmed deal closes. */
import { planDealFinalization, type DealFinalizationInput } from '../../core/deal-finalization';

const deal = { questions: [{ reciprocalTagContext: true }] };
const plain = { questions: [{}] };
function input(overrides: Partial<DealFinalizationInput> = {}): DealFinalizationInput {
  return {
    myId: 'me', otherUserId: 'bob', dealConfirmedBy: ['me', 'bob'], conversationId: 'c1',
    myTalks: {
      ride: { role: 'created', fullTalk: deal },
      bike: { role: 'created', fullTalk: deal },
      old: { role: 'created', disabled: true, fullTalk: deal },
      survey: { role: 'created', fullTalk: plain },
      theirs: { role: 'answered', fullTalk: deal },
    },
    needKeys: { c1: 'need-ride', c2: 'need-ride', c3: 'need-bike' },
    isDealEligible: (talk) => ((talk as typeof deal)?.questions ?? []).some((q) => q?.reciprocalTagContext === true),
    ...overrides,
  };
}

describe('planDealFinalization', () => {
  it('waits for both confirmations', () => {
    expect(planDealFinalization(input({ dealConfirmedBy: ['me'] }))).toBeNull();
    expect(planDealFinalization(input({ otherUserId: '' }))).toBeNull();
  });

  it('disables the recorded Talk, and supersedes conversations formed through the same need', () => {
    expect(planDealFinalization(input({ recordedTalkId: 'ride' }))).toEqual({ talkIdsToDisable: ['ride'], supersededConversationIds: ['c2'] });
  });

  it('a recorded Talk already disabled keeps the plan to it alone (a repeat call changes nothing more)', () => {
    expect(planDealFinalization(input({ recordedTalkId: 'old' }))?.talkIdsToDisable).toEqual(['old']);
  });

  it('without a record, every active deal-eligible Talk of mine — never surveys or Talks I only answered', () => {
    expect(planDealFinalization(input())?.talkIdsToDisable).toEqual(['ride', 'bike']);
    expect(planDealFinalization(input({ recordedTalkId: 'nope' }))?.talkIdsToDisable).toEqual(['ride', 'bike']);
  });

  it('no need recorded for the conversation: nothing is superseded', () => {
    expect(planDealFinalization(input({ conversationId: 'c9' }))?.supersededConversationIds).toEqual([]);
  });
});
