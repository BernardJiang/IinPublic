import { deleteMyTalkEntry } from './my-talks-storage';
import { getAnsweredTalkByContent, setAnsweredTalkByContent } from './answer-preferences-storage';
import type { UiTranslationKey } from './ui-translations';

export type TalkDeletionDeps = {
  displayTalksList: () => void;
  displayAnswersList: () => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload: unknown) => void;
};

export function deleteMyTalk(talkId: string, deps: TalkDeletionDeps): void {
  deleteMyTalkEntry(talkId);
  const answeredByContent = getAnsweredTalkByContent();
  for (const [key, id] of Object.entries(answeredByContent)) {
    if (id === talkId) {
      delete answeredByContent[key];
      setAnsweredTalkByContent(answeredByContent);
      break;
    }
  }
  deps.displayTalksList();
  deps.displayAnswersList();
  deps.showNotification(deps.t('talksRemovedFromList'), 'success');
  // Phase F: notify ledger of withdrawal so peers stop routing this talk
  deps.emit('withdrawTalk', { talkId });
  // Step 10: hard retraction — flood talk-retracted frame to all holders.
  // retractTalk carries retractedAt so the responder can order the tombstone.
  deps.emit('retractTalk', { talkId, retractedAt: Date.now() });
}
