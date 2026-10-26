/**
 * What a mutually confirmed deal closes (OPEN-91 P4), moved out of `app.ts`
 * (`maybeFinalizeConfirmedDeal`). Pure: the caller carries out the plan (disables the Talks, ends
 * the other conversations).
 *
 * - The Talk of mine the deal formed through is disabled — or, when that was not recorded, every
 *   one of my still-active deal-eligible Talks. A Talk recorded and already disabled keeps the plan
 *   to that Talk alone, so a second call (the click, then its sync echo) changes nothing more.
 * - Other responders who matched those Talks are ended (the caller's rule 1).
 * - My other conversations formed through the same content-hash "need" — even through another
 *   author's Talk — are superseded (rule 2).
 */
export type DealFinalizationInput = {
  myId: string;
  otherUserId: string;
  dealConfirmedBy: readonly string[];
  conversationId?: string;
  /** My Talks: role, disabled flag and full Talk, by id. */
  myTalks: Record<string, { role?: string | undefined; disabled?: boolean | undefined; fullTalk?: unknown } | undefined>;
  /** The Talk of mine the conversation formed through, if recorded. */
  recordedTalkId?: string;
  /** Every conversation's content-hash need, by conversation id. */
  needKeys: Record<string, string>;
  isDealEligible(talk: unknown): boolean;
};

export type DealFinalizationPlan = {
  talkIdsToDisable: string[];
  supersededConversationIds: string[];
};

/** Null until both people have confirmed. */
export function planDealFinalization(input: DealFinalizationInput): DealFinalizationPlan | null {
  if (!input.myId || !input.otherUserId) return null;
  if (!input.dealConfirmedBy.includes(input.myId) || !input.dealConfirmedBy.includes(input.otherUserId)) return null;
  const eligible = new Set<string>();
  const active: string[] = [];
  for (const [talkId, entry] of Object.entries(input.myTalks)) {
    if (!entry || entry.role !== 'created') continue;
    if (!input.isDealEligible(entry.fullTalk || entry)) continue;
    eligible.add(talkId);
    if (!entry.disabled) active.push(talkId);
  }
  const talkIdsToDisable = input.recordedTalkId && eligible.has(input.recordedTalkId) ? [input.recordedTalkId] : active;
  const needKey = input.conversationId ? input.needKeys[input.conversationId] : undefined;
  const supersededConversationIds = needKey
    ? Object.keys(input.needKeys).filter((id) => id !== input.conversationId && input.needKeys[id] === needKey)
    : [];
  return { talkIdsToDisable, supersededConversationIds };
}
