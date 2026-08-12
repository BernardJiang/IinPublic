import { planChatbotTalkFlow } from '../../shared/chatbot-talk-flow';

describe('chatbot in accepted Gun Talk flow', () => {
  const reuse = { action: 'ANSWER' as const, reason: 'PERMANENT_MATCH' as const, answerId: 'tea', answerText: 'Tea' };
  const changed = { action: 'ASK_USER' as const, reason: 'NO_HISTORY' as const };

  test('exact reuse auto-submits only after accepted persistence', () => {
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: false, withdrawn: false, chatbotEnabled: true, questionResults: [reuse] })).toEqual({ action: 'wait-for-persistence' });
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: true, withdrawn: false, chatbotEnabled: true, questionResults: [reuse] })).toEqual({ action: 'auto-submit', answerIds: ['tea'] });
  });

  test('partial reuse prompts only for changed questions', () => {
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: true, withdrawn: false, chatbotEnabled: true, questionResults: [reuse, changed] }))
      .toEqual({ action: 'differential-prompt', reusableAnswerIds: ['tea'], unresolvedQuestionIndexes: [1] });
  });

  test('withdrawn Talk blocks submission and requests stale-answer notification', () => {
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: true, withdrawn: true, chatbotEnabled: true, questionResults: [reuse] }))
      .toEqual({ action: 'withdrawn', notifyStaleAnswer: true });
  });

  test('manual mode never auto-submits', () => {
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: true, withdrawn: false, chatbotEnabled: false, questionResults: [reuse] })).toEqual({ action: 'manual' });
  });

  test.each(['direct', 'relay', 'peer-forward', 'mailbox'])('same result over %s delivery', () => {
    expect(planChatbotTalkFlow({ acceptedTalkPersisted: true, withdrawn: false, chatbotEnabled: true, questionResults: [reuse] }))
      .toEqual({ action: 'auto-submit', answerIds: ['tea'] });
  });
});

