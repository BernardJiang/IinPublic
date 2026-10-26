/** OPEN-91 P4: one rule for the chatbot's reply and the 🤖 badge. */
import { chatbotWillAct, decideChatbotReply, type ChatbotReplyLookups } from '../../core/chatbot-reply';

function lookups(overrides: Partial<ChatbotReplyLookups> = {}): ChatbotReplyLookups {
  return {
    enabled: () => true, handled: () => false, contentId: () => 'cid', answeredBefore: () => false,
    hasAnswers: () => true, passedTag: () => false, ...overrides,
  };
}

describe('decideChatbotReply', () => {
  it('answers when it has answers, passes a passed tag, and waits otherwise', () => {
    expect(decideChatbotReply('bob', 'me', lookups())).toEqual({ act: 'answer', contentId: 'cid' });
    expect(decideChatbotReply('bob', 'me', lookups({ hasAnswers: () => false, passedTag: () => true }))).toEqual({ act: 'pass', contentId: 'cid' });
    expect(decideChatbotReply('bob', 'me', lookups({ hasAnswers: () => false }))).toEqual({ act: 'wait', contentId: 'cid' });
  });

  it('skips my own Talks, handled pairs, a disabled chatbot, unhashable Talks and content answered before', () => {
    expect(decideChatbotReply('me', 'me', lookups())).toEqual({ act: 'skip', reason: 'self' });
    expect(decideChatbotReply('bob', 'me', lookups({ handled: () => true }))).toEqual({ act: 'skip', reason: 'handled' });
    expect(decideChatbotReply('bob', 'me', lookups({ enabled: () => false }))).toEqual({ act: 'skip', reason: 'disabled' });
    expect(decideChatbotReply('bob', 'me', lookups({ contentId: () => { throw new Error('bad'); } }))).toEqual({ act: 'skip', reason: 'unhashable' });
    expect(decideChatbotReply('bob', 'me', lookups({ answeredBefore: () => true }))).toEqual({ act: 'skip', reason: 'answered' });
  });

  it('the 🤖 badge shows exactly when the chatbot will answer or pass now', () => {
    expect(chatbotWillAct(decideChatbotReply('bob', 'me', lookups()))).toBe(true);
    expect(chatbotWillAct(decideChatbotReply('bob', 'me', lookups({ hasAnswers: () => false, passedTag: () => true })))).toBe(true);
    expect(chatbotWillAct(decideChatbotReply('bob', 'me', lookups({ hasAnswers: () => false })))).toBe(false);
  });

  it('asks nothing it does not need: a disabled chatbot never hashes the Talk', () => {
    const contentId = jest.fn(() => 'cid');
    decideChatbotReply('bob', 'me', lookups({ enabled: () => false, contentId }));
    expect(contentId).not.toHaveBeenCalled();
  });
});
