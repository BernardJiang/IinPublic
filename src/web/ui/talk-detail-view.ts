import { isValidTalkId } from '../../shared/incoming-talk-ids';
import { getMyTalks } from './my-talks-storage';
import type { UiTranslationKey } from './ui-translations';

export type TalkDetailViewDeps = {
  emit: (event: string, payload: unknown) => void;
  showTalkResponseDialog: (talk: any, options?: { skipAutoAnswer?: boolean; targetQuestionId?: string }) => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info', options?: { retry?: () => void }) => void;
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, values: Record<string, string | number>) => string;
  showTalkDetail: (talkId: string, identityKeyFallback?: string, options?: { preferAnswerView?: boolean; questionId?: string }) => void;
};

export function showTalkDetail(
  talkId: string,
  identityKeyFallback: string | undefined,
  options: { preferAnswerView?: boolean; questionId?: string } | undefined,
  deps: TalkDetailViewDeps,
): void {
  const raw = (talkId || '').trim();
  const tid = isValidTalkId(raw) ? raw : '';
  if (!tid && identityKeyFallback) {
    deps.emit('demandFullTalkByIdentity', {
      identityKey: identityKeyFallback,
      callback: (fullTalk: any) => {
        if (fullTalk) deps.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
        else deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
      },
    });
    return;
  }
  if (!tid) {
    deps.showNotification(deps.t('talksCouldNotOpen'), 'error');
    return;
  }

  const myTalks = getMyTalks();
  const talk = myTalks[tid];

  if (talk) {
    const preferAnswerView = options?.preferAnswerView && !!talk.fullTalk;
    if (talk.role === 'created' && !preferAnswerView) {
      // Open editor for editing
      deps.emit('loadTalkForEdit', { talkId: tid });
    } else if ((talk.role === 'answered' || talk.role === 'copied' || preferAnswerView) && talk.fullTalk) {
      // Open response view without auto-answering (avoid instant "Match!" toast when just viewing)
      deps.showTalkResponseDialog(talk.fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
    } else {
      deps.showNotification(deps.tf('talksDetailNotice', { title: talk.title }), 'info');
    }
  } else {
    // Incoming: load by id; if Gun gave a bad id, app retries via identityKey from server API.
    deps.emit('demandFullTalk', {
      talkId: tid,
      identityKeyFallback: identityKeyFallback || undefined,
      callback: (fullTalk: any) => {
        if (fullTalk) deps.showTalkResponseDialog(fullTalk, { skipAutoAnswer: true, ...(options?.questionId ? { targetQuestionId: options.questionId } : {}) });
        // TODO §P: a real retry, not a one-shot toast whose copy claims retry it doesn't
        // perform — clicking re-runs this same lookup (mesh cache/identity-key resolution
        // may have caught up since the first attempt).
        else
          deps.showNotification(
            deps.t('talksCouldNotLoadRetry'),
            'error',
            { retry: () => deps.showTalkDetail(talkId, identityKeyFallback, options) },
          );
      },
    });
  }
}
