import { isValidTalkId } from '../../shared/incoming-talk-ids';
import type { UiTranslationKey } from './ui-translations';

export type QuickAnswerIncomingTagDeps = {
  emit: (event: string, payload: unknown) => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
  t: (key: UiTranslationKey) => string;
  quickCompleteTagTalk: (talk: any, checked: boolean) => void;
};

export function quickAnswerIncomingTag(
  talkId: string,
  identityKeyFallback: string | undefined,
  checked: boolean,
  deps: QuickAnswerIncomingTagDeps,
): void {
  const finish = (fullTalk: any): void => {
    if (!fullTalk) {
      deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
      return;
    }
    deps.quickCompleteTagTalk(fullTalk, checked);
  };
  const tid = isValidTalkId((talkId || '').trim()) ? talkId.trim() : '';
  if (!tid && identityKeyFallback) {
    deps.emit('demandFullTalkByIdentity', { identityKey: identityKeyFallback, callback: finish });
    return;
  }
  if (!tid) {
    deps.showNotification(deps.t('talksCouldNotOpen'), 'error');
    return;
  }
  deps.emit('demandFullTalk', { talkId: tid, identityKeyFallback: identityKeyFallback || undefined, callback: finish });
}
