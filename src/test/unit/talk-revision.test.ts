/** @jest-environment jsdom */
import { computeTalkRevisionHash } from '../../shared/talk-revision';
import { computeTalkIdFromTalkData } from '../../shared/cid';
import { recordTalkRevisionSent, talkRevisionOwedToPeer } from '../../web/services/talk-revision-sent-store';
import { isBroadcastUnsentForReceiver } from '../../web/ui/broadcast-delivery-selection';
import { applyTalkRevisionToAnsweredCopy } from '../../web/ui/talk-completion';
import { getMyTalks, setMyTalks } from '../../web/ui/my-talks-storage';
import { setAnsweredTalkByContent } from '../../web/ui/answer-preferences-storage';

const flow = (overrides: Record<string, any> = {}) => ({
  id: 't1',
  title: 'Tennis',
  type: 'flow',
  language: 'en',
  questions: [
    { id: 'q_0', text: 'Do you play tennis?', answers: [
      { id: 'a1', text: 'Yes', isMatch: true }, { id: 'a2', text: 'No', isIgnore: true },
    ] },
  ],
  ...overrides,
});

beforeEach(() => localStorage.clear());

describe('computeTalkRevisionHash (OPEN-40)', () => {
  it('changes with title or routing while the content identity stays the same', () => {
    const base = flow();
    const retitled = flow({ title: 'Tennis partner' });
    const rerouted = flow({ questions: [{ ...base.questions[0], answers: [
      { id: 'a1', text: 'Yes', isIgnore: true }, { id: 'a2', text: 'No', isMatch: true },
    ] }] });
    expect(computeTalkIdFromTalkData(retitled)).toBe(computeTalkIdFromTalkData(base));
    expect(computeTalkIdFromTalkData(rerouted)).toBe(computeTalkIdFromTalkData(base));
    expect(computeTalkRevisionHash(retitled)).not.toBe(computeTalkRevisionHash(base));
    expect(computeTalkRevisionHash(rerouted)).not.toBe(computeTalkRevisionHash(base));
  });

  it('ignores survey counters and other non-authored fields', () => {
    const counted = flow({ createdAt: 'x', questions: [{ ...flow().questions[0], answers: flow().questions[0].answers.map((a) => ({ ...a, counter: 7 })) }] });
    expect(computeTalkRevisionHash(counted)).toBe(computeTalkRevisionHash(flow()));
  });
});

describe('talk revision sent store', () => {
  it('owes nothing for an unknown peer/talk, but takes a baseline when asked', () => {
    expect(talkRevisionOwedToPeer('peer', 't1', 'rev_a')).toBe(false);
    expect(talkRevisionOwedToPeer('peer', 't1', 'rev_a', { baselineIfUnknown: true })).toBe(false);
    expect(talkRevisionOwedToPeer('peer', 't1', 'rev_b')).toBe(true);
  });

  it('owes the update until the new revision is recorded as sent', () => {
    recordTalkRevisionSent('peer', 't1', 'rev_a');
    expect(talkRevisionOwedToPeer('peer', 't1', 'rev_b')).toBe(true);
    recordTalkRevisionSent('peer', 't1', 'rev_b');
    expect(talkRevisionOwedToPeer('peer', 't1', 'rev_b')).toBe(false);
  });
});

describe('broadcast selection includes revision updates', () => {
  it('re-offers a talk whose content was exchanged but whose revision changed', () => {
    const deps = {
      getMyTalks: () => ({ t1: { fullTalk: flow({ title: 'New title' }) } }),
      getBroadcastableTalkIds: () => ['t1'],
      shouldSuppressForPeer: () => true,
      revisionOwedToPeer: jest.fn(() => true),
    };
    expect(isBroadcastUnsentForReceiver('peer', 't1', deps)).toBe(true);
    deps.revisionOwedToPeer.mockReturnValue(false);
    expect(isBroadcastUnsentForReceiver('peer', 't1', deps)).toBe(false);
  });
});

describe('applyTalkRevisionToAnsweredCopy', () => {
  it('refreshes an answered copy from the same author in place and keeps the answers', () => {
    const original = flow();
    setMyTalks({ t1: {
      talkId: 't1', title: 'Tennis', type: 'flow', timestamp: '', role: 'answered',
      fullTalk: original, senders: ['author'], completedAnswers: [{ questionId: 'q_0', answerId: 'a1' }],
    } });
    setAnsweredTalkByContent({ [computeTalkIdFromTalkData(original)]: 't1' });

    expect(applyTalkRevisionToAnsweredCopy(flow({ title: 'Tennis partner' }), 'author')).toBe(true);
    expect(getMyTalks().t1.title).toBe('Tennis partner');
    expect(getMyTalks().t1.completedAnswers).toHaveLength(1);
  });

  it('is not an update for another author or for content never answered', () => {
    const original = flow();
    setMyTalks({ t1: { talkId: 't1', title: 'Tennis', type: 'flow', timestamp: '', role: 'answered', fullTalk: original, senders: ['author'] } });
    setAnsweredTalkByContent({ [computeTalkIdFromTalkData(original)]: 't1' });
    expect(applyTalkRevisionToAnsweredCopy(flow({ title: 'X' }), 'someone-else')).toBe(false);
    expect(applyTalkRevisionToAnsweredCopy(flow({ questions: [{ id: 'q_0', text: 'Other?', answers: [] }] }), 'author')).toBe(false);
  });
});
