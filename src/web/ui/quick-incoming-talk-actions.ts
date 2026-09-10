import { isValidTalkId } from '../../shared/incoming-talk-ids';
import type { UiTranslationKey } from './ui-translations';
import type { MyTalkEntry } from './my-talks-storage';

/**
 * Shared async full-talk resolution: an incoming cluster carries only `.latestTalkId`/
 * `.questionsJson` on the wire, not a full Talk object, so both quick actions below resolve it
 * the same way `quickAnswerIncomingTag` does — via `demandFullTalk`(ByIdentity), then call
 * `finish` once it arrives.
 */
function resolveIncomingFullTalk(
  emit: (event: string, payload: unknown) => void,
  t: (key: UiTranslationKey) => string,
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void,
  talkId: string,
  identityKeyFallback: string | undefined,
  finish: (fullTalk: any) => void,
): void {
  const tid = isValidTalkId((talkId || '').trim()) ? talkId.trim() : '';
  if (!tid && identityKeyFallback) {
    emit('demandFullTalkByIdentity', { identityKey: identityKeyFallback, callback: finish });
    return;
  }
  if (!tid) {
    showNotification(t('talksCouldNotOpen'), 'error');
    return;
  }
  emit('demandFullTalk', { talkId: tid, identityKeyFallback: identityKeyFallback || undefined, callback: finish });
}

export type QuickIgnoreIncomingTalkDeps = {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  saveAnswerPreference: (
    talk: any,
    talkInstanceId: string,
    currentQuestion: any,
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode: 'auto' | 'manual' | 'permanent' | 'suppressed',
  ) => void;
  completeTalk: (talk: any, answers: any[], outcome: 'match' | 'mismatch', meta?: { withholdFromSender?: boolean }) => void;
  emit: (event: string, payload: unknown) => void;
};

/** Row gesture (drag up): ignores an incoming talk without ever opening its response dialog. */
export function quickIgnoreIncomingTalk(talkId: string, identityKeyFallback: string | undefined, deps: QuickIgnoreIncomingTalkDeps): void {
  const finish = (fullTalk: any): void => {
    if (!fullTalk) {
      deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
      return;
    }
    const question = Array.isArray(fullTalk.questions) ? fullTalk.questions[0] : null;
    const answers = question ? [{ questionId: question.id, answerId: 'ignore', answerText: 'ignore', mode: 'manual' }] : [];
    if (question) {
      deps.saveAnswerPreference(
        fullTalk, fullTalk.id, question, 'ignore', 'ignore',
        answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
        'suppressed',
      );
    }
    deps.showNotification(deps.t('responseTalkIgnored'), 'info');
    deps.completeTalk(fullTalk, answers, 'mismatch', { withholdFromSender: true });
  };
  resolveIncomingFullTalk(deps.emit, deps.t, deps.showNotification, talkId, identityKeyFallback, finish);
}

export type QuickCopyIncomingTalkDeps = {
  getMyTalks: () => Record<string, MyTalkEntry>;
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  saveMyTalk: (talkData: MyTalkEntry) => void;
  refreshTalksList: () => void;
  emit: (event: string, payload: unknown) => void;
};

/**
 * Row gesture (drag down): copies an incoming talk into the user's own outgoing list
 * *without* answering it — distinct from `copyAnsweredTalkToTalks`, which only works on
 * an already-answered `myTalks` entry. A live incoming cluster has no `myTalks[talkId]`
 * row yet and no `.latestTalk` full-Talk object (only `.latestTalkId`/`.questionsJson`
 * on the wire type), so the full talk has to be resolved the same asynchronous way
 * `quickAnswerIncomingTag` does it, then saved directly with role 'copied' — bypassing
 * `completeTalk` entirely so the sender is never notified and the incoming cluster
 * stays in the inbox exactly as it was.
 */
export function quickCopyIncomingTalk(
  talkId: string,
  identityKeyFallback: string | undefined,
  cluster: any,
  deps: QuickCopyIncomingTalkDeps,
): void {
  const existing = talkId ? deps.getMyTalks()[talkId] : undefined;
  if (existing?.role === 'copied') {
    deps.showNotification(deps.t('talksAlreadyCopied'), 'info');
    return;
  }
  const finish = (fullTalk: any): void => {
    if (!fullTalk) {
      deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
      return;
    }
    const senders = cluster?.senders && typeof cluster.senders === 'object'
      ? Array.from(new Set(Object.values(cluster.senders).map((s: any) => String(s?.senderId || '')).filter(Boolean)))
      : undefined;
    deps.saveMyTalk({
      talkId: fullTalk.id || talkId,
      title: fullTalk.title,
      type: fullTalk.type,
      timestamp: new Date().toISOString(),
      role: 'copied',
      fullTalk,
      ...(senders && senders.length > 0 ? { senders } : {}),
    } as MyTalkEntry);
    deps.showNotification(deps.t('talksCopiedToList'), 'success');
    deps.refreshTalksList();
  };
  resolveIncomingFullTalk(deps.emit, deps.t, deps.showNotification, talkId, identityKeyFallback, finish);
}
