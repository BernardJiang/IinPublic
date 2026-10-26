/**
 * Rules for my list of Talks (OPEN-91 P4), moved out of `src/web/ui/` (quick incoming-Talk
 * actions, deletion): copying a received Talk, undoing it, ignoring one, removing one and
 * restoring one from the Ignored list. Pure; the caller saves and redraws.
 */

type Entry = Record<string, any>;

/** The Ignore choice for a Talk's first question (a talk-level opt-out; nothing goes to the sender). */
export function ignoreAnswersFor(fullTalk: any): Array<{ questionId: string; answerId: string; answerText: string; mode: string }> {
  const question = Array.isArray(fullTalk?.questions) ? fullTalk.questions[0] : null;
  return question ? [{ questionId: question.id, answerId: 'ignore', answerText: 'ignore', mode: 'manual' }] : [];
}

/** A received Talk copied into my own list, without answering it; its senders come along. */
export function copiedTalkEntry(fullTalk: any, talkId: string, cluster: any, nowIso: string): Entry {
  const senders = cluster?.senders && typeof cluster.senders === 'object'
    ? Array.from(new Set(Object.values(cluster.senders).map((s: any) => String(s?.senderId || '')).filter(Boolean)))
    : undefined;
  return {
    talkId: fullTalk.id || talkId,
    title: fullTalk.title,
    type: fullTalk.type,
    timestamp: nowIso,
    role: 'copied',
    fullTalk,
    ...(senders && senders.length > 0 ? { senders } : {}),
  };
}

/**
 * Undoing a copy: an answered Talk goes back to plain answered history (its answers stay); a copy
 * made before answering is dropped (null). Anything not a copy is left alone (undefined).
 */
export function uncopiedTalkEntry(existing: Entry | undefined, nowIso: string): Entry | null | undefined {
  if (existing?.role !== 'copied') return undefined;
  if (Array.isArray(existing.completedAnswers) && existing.completedAnswers.length > 0) {
    return { ...existing, role: 'answered', lastInteraction: nowIso };
  }
  return null;
}

/**
 * A copy of a received Flow/Survey/Route that was already answered: ownership and completion are
 * independent, so removing the copy must not forget the answer — otherwise the sender's original
 * would resurface as unanswered. Tags differ on purpose: unchecking a retained tag is the answer
 * itself, so it still clears everything.
 */
export function isAnsweredNonTagCopy(entry: Entry | undefined): boolean {
  const type = String(entry?.type || entry?.fullTalk?.type || '').toLowerCase();
  return entry?.role === 'copied' && type !== 'tag' && Array.isArray(entry?.completedAnswers) && entry.completedAnswers.length > 0;
}

/**
 * Removing a Talk from my list: whether its answers and preferences go too, and whether peers
 * are told. Only the author withdraws a network Talk; removing a received or copied one is local.
 */
export function planTalkRemoval(existing: Entry | undefined): { keepAnswers: boolean; retract: boolean } {
  return { keepAnswers: isAnsweredNonTagCopy(existing), retract: existing?.role === 'created' };
}

/** Restoring from the Ignored list: back to the role it had, unanswered; nothing if it had none. */
export function restoredFromIgnored(existing: Entry, nowIso: string): Entry | null {
  if (!existing.roleBeforeIgnore) return null;
  const restored: Entry = { ...existing, role: existing.roleBeforeIgnore, lastInteraction: nowIso };
  delete restored.roleBeforeIgnore;
  delete restored.completedAnswers;
  delete restored.outcome;
  return restored;
}
