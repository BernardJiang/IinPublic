/** OPEN-91 P4: small Talk rules shared by delivery, the chatbot and deals. */
import { answeredBeforeFor, isDealEligibleTalk, isPassedTag, matchScoreParamsFor, selectedTalkIdentityKeys, talkRevisionPairKey } from '../../core/talk-rules';
import { createEmptyExactChatbotMemoryState, LOCAL_EXACT_CHATBOT_USER_ID, saveSuppressedQuestion } from '../../shared/exact-chatbot-memory';

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
    const myTalks = { copy: { senders: ['ann'] } };
    expect(answeredBeforeFor('cid', 'ann', { cid: 'copy' }, myTalks)).toBe(true);
    expect(answeredBeforeFor('cid', 'bob', { cid: 'copy' }, myTalks)).toBe(false);
    expect(answeredBeforeFor('', 'ann', { cid: 'copy' }, myTalks)).toBe(false);
  });

  it('a one-keyword tag I passed is passed; one I did not is not', () => {
    const tag = { type: 'tag', language: 'en', questions: [{ id: 'q1', text: 'Opera', answers: [{ id: 'y', text: 'Opera' }] }] };
    const memory = createEmptyExactChatbotMemoryState();
    expect(isPassedTag(tag, memory, Date.now())).toBe(false);
    saveSuppressedQuestion(memory, LOCAL_EXACT_CHATBOT_USER_ID, 'Opera', undefined, { language: 'en' });
    expect(isPassedTag(tag, memory, Date.now())).toBe(true);
    expect(isPassedTag(tags, memory, Date.now())).toBe(false);
  });
});
