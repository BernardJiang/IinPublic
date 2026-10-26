import { planTalkRemoval, restoredFromIgnored } from '../../core/my-talk-rules';
import { deleteFlatAnswerHistoryForTalk } from './answer-history-storage';
import { deleteAnswerPreferencesForTalk } from './answer-preference-mutations';
import { deleteMyTalkEntry, getMyTalks, setMyTalks } from './my-talks-storage';
import { getAnsweredTalkByContent, setAnsweredTalkByContent } from './answer-preferences-storage';
import type { UiTranslationKey } from './ui-translations';

export type TalkDeletionDeps = {
  displayTalksList: () => void;
  displayAnswersList: () => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload: unknown) => void;
};

/** The rules (what removal keeps, who is told) are the device core's (src/core/my-talk-rules.ts). */
export function removeLocalTalkState(talkId: string): void {
  deleteMyTalkEntry(talkId);
  deleteFlatAnswerHistoryForTalk(talkId);
  deleteAnswerPreferencesForTalk(talkId);
  const answeredByContent = getAnsweredTalkByContent();
  let answeredContentChanged = false;
  for (const [key, id] of Object.entries(answeredByContent)) {
    if (id === talkId) {
      delete answeredByContent[key];
      answeredContentChanged = true;
    }
  }
  if (answeredContentChanged) setAnsweredTalkByContent(answeredByContent);
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
