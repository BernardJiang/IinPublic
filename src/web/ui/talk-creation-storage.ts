import { getMyTalks, setMyTalks } from './my-talks-storage';

export type SaveCreatedTalkDeps = {
  /** Persists one self-answer for chatbot/auto-reply (bound to the current user id). */
  saveAnswerPreference: (
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[] },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode: 'auto' | 'manual' | 'permanent' | 'suppressed',
  ) => void;
  saveQuestionAnswersFromCompletion: (
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
  ) => void;
  saveFlatAnswerHistoryRecord: (
    talkId: string,
    talk: any,
    completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string; mode?: string }>,
    outcome: 'match' | 'mismatch',
    senders: string[],
  ) => void;
  /** Re-renders the talks list only when it's the currently active view. */
  refreshTalksListIfActive: () => void;
};

/**
 * Stores an authored talk in `myTalks` and, for each self-answer the author gave while
 * creating it, cascades that answer through the same preference/history stores a real
 * completion would (chatbot auto-reply, flat answer history) — an author's own self-answers
 * are otherwise invisible to those stores.
 */
export function saveCreatedTalk(
  talk: { id: string; title: string; type: string; questions: any[]; language?: string; expiresAt?: number | null; locationRadiusMiles?: number | null },
  options: { selfAnswers: { questionId: string; answerId: string }[] },
  deps: SaveCreatedTalkDeps,
): void {
  const myTalks = getMyTalks();
  const uncheckedTag = talk.type === 'tag' && options.selfAnswers.some((answer) => answer.answerId === 'ignore' || answer.answerId.includes('ignore'));
  myTalks[talk.id] = {
    ...myTalks[talk.id],
    talkId: talk.id,
    title: talk.title,
    type: talk.type,
    language: talk.language || 'en',
    timestamp: new Date().toISOString(),
    role: 'created',
    fullTalk: talk,
    disabled: uncheckedTag,
    expiresAt: talk.expiresAt ?? undefined,
    locationRadiusMiles: talk.locationRadiusMiles ?? undefined,
    lastInteraction: new Date().toISOString(),
  };
  setMyTalks(myTalks);

  // Save self-answers to answer preferences (user's answer list) for chatbot/auto-reply
  const acc: Array<{ questionId: string; answerText?: string }> = [];
  const completedAnswers: Array<{ questionId: string; answerId: string; answerText?: string; mode?: string }> = [];
  let hasMatchAnswer = false;
  for (const { questionId, answerId } of options.selfAnswers) {
    const q = talk.questions?.find((qu: any) => qu.id === questionId);
    if (!q) continue;
    const a = q.answers?.find((an: any) => an.id === answerId);
    if (!a) continue;
    acc.push({ questionId, answerText: a.text });
    completedAnswers.push({
      questionId,
      answerId,
      answerText: a.text || '',
      mode: 'manual',
    });
    if (a.isMatch === true) hasMatchAnswer = true;
    deps.saveAnswerPreference(talk, talk.id, q, a.id, a.text || '', acc, 'auto');
  }
  if (completedAnswers.length > 0) {
    deps.saveQuestionAnswersFromCompletion(talk, completedAnswers);
    deps.saveFlatAnswerHistoryRecord(talk.id, talk, completedAnswers, hasMatchAnswer ? 'match' : 'mismatch', []);
  }

  const talksView = document.getElementById('talks-view');
  if (talksView?.classList.contains('active')) {
    deps.refreshTalksListIfActive();
  }
}

export type CopyAnsweredTalkToTalksDeps = {
  showNotification: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
  t: (key: import('./ui-translations').UiTranslationKey) => string;
  saveMyTalk: (talkData: import('./my-talks-storage').MyTalkEntry) => void;
  refreshTalksList: () => void;
  refreshAnswersList: () => void;
};

/**
 * Copies an answered (not self-authored) talk into the user's own Talks list as a `role:
 * 'copied'` entry — not authorship (docs/TODO.md §Y1): the original sender stays `authorId`
 * until the user actually edits the content through the revise-mints-new-id path.
 */
export function copyAnsweredTalkToTalks(talkId: string, deps: CopyAnsweredTalkToTalksDeps): void {
  const myTalks = getMyTalks();
  const talk = myTalks[talkId];
  if (!talk?.fullTalk) {
    deps.showNotification(deps.t('talksDataNotFound'), 'error');
    return;
  }
  if (talk.role === 'copied') {
    deps.showNotification(deps.t('talksAlreadyCopied'), 'info');
    return;
  }
  deps.saveMyTalk({
    talkId,
    title: talk.title,
    type: talk.type,
    timestamp: talk.lastInteraction || new Date().toISOString(),
    role: 'copied',
    fullTalk: talk.fullTalk,
    completedAnswers: talk.completedAnswers,
    outcome: talk.outcome,
    senders: talk.senders,
  });
  deps.showNotification(deps.t('talksCopiedToList'), 'success');
  deps.refreshTalksList();
  deps.refreshAnswersList();
}
