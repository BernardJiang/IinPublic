/** OPEN-91 P4: small Talk rules shared by delivery, the chatbot and deals. */
import { answeredBeforeFor, isDealEligibleTalk, matchScoreParamsFor, selectedTalkIdentityKeys, talkRevisionPairKey } from '../../core/talk-rules';

const tags = { type: 'tag', title: 'Likes', language: 'en', questions: [{ id: 'q1', text: 'Likes', answers: [{ id: 'a', text: 'Tennis' }, { id: 'b', text: 'Chess' }] }] };

describe('talk rules', () => {
  it('a tag answer covers the tags selected; anything else covers the whole Talk', () => {
    const one = selectedTalkIdentityKeys(tags, [{ answerId: 'a' }]);
    const both = selectedTalkIdentityKeys(tags, [{ answerId: 'a' }, { answerText: 'chess' }]);
    expect(both.length).toBeGreaterThan(one.length);
    expect(selectedTalkIdentityKeys({ ...tags, type: 'flow' }, [{ answerId: 'a' }])).toHaveLength(1);
  });

  it('a revision key changes with the title, and survives an unhashable body', () => {
    expect(talkRevisionPairKey('t', 'ann', tags)).not.toBe(talkRevisionPairKey('t', 'ann', { ...tags, title: 'Loves' }));
    expect(talkRevisionPairKey('t', 'ann', undefined)).toBe('t::ann::');
  });

  it('deal eligibility needs a Pair-tag question; a plain Talk has no route score', () => {
    expect(isDealEligibleTalk({ questions: [{ reciprocalTagContext: true }] })).toBe(true);
    expect(isDealEligibleTalk(tags)).toBe(false);
    expect(matchScoreParamsFor(tags, [])).toEqual({});
  });

  it('answered before: only for a sender my answered copy lists', () => {
    const answered = (contentId: string) => (contentId === 'cid' ? 'copy' : undefined);
    const myTalk = (talkId: string) => (talkId === 'copy' ? { senders: ['ann'] } : undefined);
    expect(answeredBeforeFor('cid', 'ann', answered, myTalk)).toBe(true);
    expect(answeredBeforeFor('cid', 'bob', answered, myTalk)).toBe(false);
    expect(answeredBeforeFor('', 'ann', answered, myTalk)).toBe(false);
  });
});
