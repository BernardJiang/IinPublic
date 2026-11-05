import { planTalkRemoval, restoredFromIgnored } from '../../core/my-talk-rules';
import { deleteFlatAnswerHistoryForTalk } from './answer-history-storage';
import { deleteMyTalkEntry, getMyTalks, setMyTalks } from './my-talks-storage';
import type { UiTranslationKey } from './ui-translations';

export type TalkDeletionDeps = {
  displayTalksList: () => void;
  displayAnswersList: () => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload: unknown) => void;
};

/**
 * My answers to a Talk leave this device: the Me tab's records (the core deletes the answer event
 * and tells the author, `app-answers.ts` `forget`). "Already answered" follows My Talks
 * (`answered-talks.ts`): the caller removes the entry or its `completedAnswers`.
 */
function forgetMyAnswers(talkId: string): void {
  deleteFlatAnswerHistoryForTalk(talkId);
}

/** The rules (what removal keeps, who is told) are the device core's (src/core/my-talk-rules.ts). */
export function removeLocalTalkState(talkId: string): void {
  deleteMyTalkEntry(talkId);
  forgetMyAnswers(talkId);
}

/** The Talks a Me row's answers came from whose answers I may delete: any I did not create. */
export function answerTalksToDelete(talkIds: string[], myTalks: Record<string, any>): string[] {
  return [...new Set(talkIds.filter(Boolean))].filter((talkId) => myTalks[talkId]?.role !== 'created');
}

/**
 * "Delete my answer" (owner decision 2026-11-03: deleted answers propagate): my answers to these
 * Talks are deleted here and their authors are told (a deletion event in the graph); any match
 * through them ends on their side. An answered Talk leaves my list (it can come back unanswered);
 * a copy I keep stays, without the answers. Returns how many Talks' answers were deleted.
 */
export function deleteMyAnswers(talkIds: string[], deps: Omit<TalkDeletionDeps, 'emit'>): number {
  const targets = answerTalksToDelete(talkIds, getMyTalks());
  for (const talkId of targets) {
    const entry = getMyTalks()[talkId];
    if (entry?.role === 'copied') {
      const myTalks = getMyTalks();
      const kept = { ...entry };
      delete kept.completedAnswers;
      delete kept.outcome;
      myTalks[talkId] = kept;
      setMyTalks(myTalks);
      forgetMyAnswers(talkId);
    } else {
      removeLocalTalkState(talkId);
    }
  }
  if (!targets.length) return 0;
  deps.displayTalksList();
  deps.displayAnswersList();
  deps.showNotification(deps.t('meAnswerDeleted'), 'success');
  return targets.length;
}

export function deleteMyTalk(talkId: string, deps: TalkDeletionDeps): void {
  const existing = getMyTalks()[talkId];
  const plan = planTalkRemoval(existing);
  if (plan.keepAnswers) deleteMyTalkEntry(talkId);
  else removeLocalTalkState(talkId);
  deps.displayTalksList();
  deps.displayAnswersList();
  deps.showNotification(deps.t('talksRemovedFromList'), 'success');
  // Only the author can withdraw a network talk. Removing a received/copied tag is a local
  // uncheck and must not tell every peer that the original author's match disappeared.
  if (plan.retract) {
    deps.emit('withdrawTalk', { talkId });
    deps.emit('retractTalk', { talkId, retractedAt: Date.now() });
  }
}

/** Restores content from the Ignored list without retracting anyone else's talk. */
export function restoreIgnoredTalk(talkId: string, deps: Omit<TalkDeletionDeps, 'emit'>): void {
  const existing = getMyTalks()[talkId];
  if (existing?.role !== 'ignored') return;
  removeLocalTalkState(talkId);
  const restored = restoredFromIgnored(existing, new Date().toISOString());
  if (restored) {
    const myTalks = getMyTalks();
    myTalks[talkId] = restored as typeof existing;
    setMyTalks(myTalks);
  }
  deps.displayTalksList();
  deps.displayAnswersList();
  deps.showNotification(deps.t('talksRestored'), 'success');
}
