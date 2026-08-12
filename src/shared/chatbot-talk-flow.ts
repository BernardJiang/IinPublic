import type { AutoAnswerResult } from './exact-chatbot-memory';

export type ChatbotFlowPlan =
  | { action: 'wait-for-persistence' }
  | { action: 'withdrawn'; notifyStaleAnswer: true }
  | { action: 'manual' }
  | { action: 'auto-submit'; answerIds: string[] }
  | { action: 'differential-prompt'; reusableAnswerIds: string[]; unresolvedQuestionIndexes: number[] };

/** Transport-independent decision made only after accepted Talk persistence. */
export function planChatbotTalkFlow(input: {
  acceptedTalkPersisted: boolean;
  withdrawn: boolean;
  chatbotEnabled: boolean;
  questionResults: readonly AutoAnswerResult[];
}): ChatbotFlowPlan {
  if (!input.acceptedTalkPersisted) return { action: 'wait-for-persistence' };
  if (input.withdrawn) return { action: 'withdrawn', notifyStaleAnswer: true };
  if (!input.chatbotEnabled) return { action: 'manual' };
  const answerIds = input.questionResults.flatMap((result) => result.action === 'ANSWER' && result.answerId ? [result.answerId] : []);
  const unresolved = input.questionResults.flatMap((result, index) => result.action === 'ASK_USER' ? [index] : []);
  if (unresolved.length === 0) return { action: 'auto-submit', answerIds };
  return { action: 'differential-prompt', reusableAnswerIds: answerIds, unresolvedQuestionIndexes: unresolved };
}

