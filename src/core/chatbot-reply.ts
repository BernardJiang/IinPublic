/**
 * Whether my chatbot answers an incoming Talk (OPEN-91 P4). One rule for both the 🤖 badge on the
 * incoming row and the reply itself — they were two copies in `app.ts` (`chatbotWillAnswer`,
 * `maybeAutoChatbotReplyToAnnouncer`). Lookups are lazy: each is asked only when the rule gets to it.
 */
export type ChatbotReplyLookups = {
  enabled(): boolean;
  /** Already answered (or passed) this revision of the Talk for this sender. */
  handled(): boolean;
  /** The Talk's content id; throws when the Talk cannot be hashed. */
  contentId(): string;
  answeredBefore(contentId: string): boolean;
  hasAnswers(contentId: string): boolean;
  /** A one-keyword tag whose keyword I passed. */
  passedTag(): boolean;
};

export type ChatbotReplyDecision =
  | { act: 'answer'; contentId: string }
  /** Pass the tag again: nothing goes back to the sender, my list records it (🤖). */
  | { act: 'pass'; contentId: string }
  /** No reusable answers yet (a template may still be saving): ask again shortly. */
  | { act: 'wait'; contentId: string }
  | { act: 'skip'; reason: 'self' | 'handled' | 'disabled' | 'unhashable' | 'answered' };

export function decideChatbotReply(authorId: string, myId: string | undefined, lookups: ChatbotReplyLookups): ChatbotReplyDecision {
  if (!authorId || authorId === myId) return { act: 'skip', reason: 'self' };
  if (lookups.handled()) return { act: 'skip', reason: 'handled' };
  if (!lookups.enabled()) return { act: 'skip', reason: 'disabled' };
  let contentId: string;
  try {
    contentId = lookups.contentId();
  } catch {
    return { act: 'skip', reason: 'unhashable' };
  }
  if (lookups.answeredBefore(contentId)) return { act: 'skip', reason: 'answered' };
  if (lookups.hasAnswers(contentId)) return { act: 'answer', contentId };
  if (lookups.passedTag()) return { act: 'pass', contentId };
  return { act: 'wait', contentId };
}

/** Whether the chatbot will act on it now — the 🤖 shown on the incoming row. */
export function chatbotWillAct(decision: ChatbotReplyDecision): boolean {
  return decision.act === 'answer' || decision.act === 'pass';
}
