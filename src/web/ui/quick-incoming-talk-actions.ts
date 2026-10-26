import { isValidTalkId } from '../../shared/incoming-talk-ids';
import type { UiTranslationKey } from './ui-translations';
import { copiedTalkEntry, ignoreAnswersFor, uncopiedTalkEntry } from '../../core/my-talk-rules';
import { getMyTalks, setMyTalks, type MyTalkEntry } from './my-talks-storage';

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
    mode: 'auto' | 'manual' | 'whenever' | 'permanent' | 'suppressed',
  ) => void;
  completeTalk: (talk: any, answers: any[], outcome: 'match' | 'mismatch', meta?: { withholdFromSender?: boolean }) => void;
  emit: (event: string, payload: unknown) => void;
};

/** Horizontal row gesture: moves this content to the user's restorable Ignored list. */
export function quickIgnoreIncomingTalk(talkId: string, identityKeyFallback: string | undefined, deps: QuickIgnoreIncomingTalkDeps): void {
  const finish = (fullTalk: any): void => {
    if (!fullTalk) {
      deps.showNotification(deps.t('talksCouldNotLoad'), 'error');
      return;
    }
    const question = Array.isArray(fullTalk.questions) ? fullTalk.questions[0] : null;
    const answers = ignoreAnswersFor(fullTalk);
    if (question) {
      deps.saveAnswerPreference(
        fullTalk, fullTalk.id, question, 'ignore', 'ignore',
        answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
        'suppressed',
      );
    }
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
 * *without* answering it. A live incoming cluster has no `myTalks[talkId]`
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
    deps.saveMyTalk(copiedTalkEntry(fullTalk, talkId, cluster, new Date().toISOString()) as MyTalkEntry);
    deps.showNotification(deps.t('talksCopiedToList'), 'success');
    deps.refreshTalksList();
  };
  // Answered incoming talks are deliberately removed from the actionable backend inbox, but
  // retained locally as read history. When the user reveals one with Talks → Answered and
  // chooses to retain it, reuse that durable fullTalk instead of trying to load a no-longer-
  // actionable inbox record from the network.
  if (existing?.fullTalk) {
    finish(existing.fullTalk);
    return;
  }
  if (cluster?.latestTalk) {
    finish(cluster.latestTalk);
    return;
  }
  resolveIncomingFullTalk(deps.emit, deps.t, deps.showNotification, talkId, identityKeyFallback, finish);
}

export type UncopyIncomingTalkDeps = {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: UiTranslationKey) => string;
  refreshTalksList: () => void;
};

/**
 * Undoes a copy from the row's 📋 toggle. An answered talk goes back to plain answered history
 * (its answers stay); a copy made before answering is dropped. Nothing is sent to anyone.
 */
export function uncopyIncomingTalk(talkId: string, deps: UncopyIncomingTalkDeps): void {
  const myTalks = getMyTalks();
  const next = uncopiedTalkEntry(myTalks[talkId], new Date().toISOString());
  if (next === undefined) return;
  if (next) myTalks[talkId] = next as MyTalkEntry;
  else delete myTalks[talkId];
  setMyTalks(myTalks);
  deps.showNotification(deps.t('talksRemovedFromList'), 'success');
  deps.refreshTalksList();
}
