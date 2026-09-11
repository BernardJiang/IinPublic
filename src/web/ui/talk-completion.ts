import { computeTalkIdFromTalkData } from '../../shared/cid';
import { getAnsweredTalkByContent, setAnsweredTalkByContent } from './answer-preferences-storage';
import { getTalkContentKey, saveFlatAnswerHistoryRecord } from './answer-history-storage';
import { getCopyTalkAutoSave } from './ui-settings-storage';
import { getMyTalks, setMyTalks, type MyTalkEntry } from './my-talks-storage';
import type { UiTranslationKey } from './ui-translations';

export type SaveMyTalkDeps = {
  displayTalksList: () => void;
};

export type TalkCompletionDeps = SaveMyTalkDeps & {
  t: (key: UiTranslationKey) => string;
  emit: (event: string, payload: unknown) => void;
  showNotification: (message: string, type: 'success' | 'error' | 'info') => void;
};

/** docs/TODO.md §Y1: refreshes the Talks tab if it's the currently active view. */
export function saveMyTalk(talkData: MyTalkEntry, deps: SaveMyTalkDeps): void {
  const myTalks = getMyTalks();
  const existing = myTalks[talkData.talkId];
  const full = talkData.fullTalk;
  myTalks[talkData.talkId] = {
    ...existing,
    ...talkData,
    disabled: talkData.disabled ?? existing?.disabled ?? false,
    expiresAt: existing?.expiresAt ?? full?.expiresAt ?? undefined,
    locationRadiusMiles: existing?.locationRadiusMiles ?? full?.locationRadiusMiles ?? undefined,
    senders: talkData.senders ?? existing?.senders ?? undefined,
    lastInteraction: new Date().toISOString(),
  };
  setMyTalks(myTalks);

  const talksView = document.getElementById('talks-view');
  if (talksView && talksView.classList.contains('active')) {
    deps.displayTalksList();
  }
}

export function completeTalk(
  talk: any,
  answers: any[],
  outcome: 'match' | 'mismatch' | undefined,
  meta: { withholdFromSender?: boolean } | undefined,
  deps: TalkCompletionDeps,
): void {
  console.log('✅ Talk completed:', talk.id, answers, outcome);

  const contentKey = getTalkContentKey(talk);
  const answeredByContent = getAnsweredTalkByContent();
  const existingTalkId = answeredByContent[contentKey];
  const myTalks = getMyTalks();
  const authorId = talk.authorId || (talk as any).authorId;

  let talkIdToUse: string;
  let senders: string[];

  if (existingTalkId && myTalks[existingTalkId]) {
    talkIdToUse = existingTalkId;
    const existing = myTalks[existingTalkId];
    const prevSenders = existing.senders || (existing.fullTalk?.authorId ? [existing.fullTalk.authorId] : []);
    senders = [...new Set([...prevSenders, authorId].filter(Boolean))];
  } else {
    talkIdToUse = talk.id;
    senders = authorId ? [authorId] : [];
    answeredByContent[contentKey] = talk.id;
    try {
      answeredByContent[computeTalkIdFromTalkData(talk)] = talk.id;
    } catch {
      /* keep legacy content key only */
    }
    setAnsweredTalkByContent(answeredByContent);
  }

  const existingEntry = myTalks[talkIdToUse];
  const wasIgnored = answers.some((answer) => {
    const answerId = String(answer?.answerId || '').toLowerCase();
    const answerText = String(answer?.answerText || '').toLowerCase();
    return answerId === 'ignore' || answerId.includes('ignore') || answerText === 'ignore';
  });
  const role = existingEntry?.role === 'copied' ? 'copied'
             : existingEntry?.role === 'created' ? 'created'
             : getCopyTalkAutoSave() && !wasIgnored ? 'copied'
             : 'answered';
  const completedAnswers = answers.map((answer) => ({
    questionId: answer.questionId,
    answerId: answer.answerId,
    ...(answer.answerText ? { answerText: answer.answerText } : {}),
    ...(answer.mode ? { mode: answer.mode } : {}),
  }));

  saveMyTalk({
    talkId: talkIdToUse,
    title: talk.title,
    type: talk.type,
    timestamp: talk.createdAt || new Date().toISOString(),
    role,
    // docs/TODO.md §Y1: auto-copy on completion is still just a copy — original authorship
    // is preserved either way until a real edit happens.
    fullTalk: existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
    completedAnswers,
    outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
    senders,
  }, deps);
  saveFlatAnswerHistoryRecord(talkIdToUse, talk, completedAnswers, outcome ?? existingEntry?.outcome ?? 'mismatch', senders);

  deps.emit('talkCompleted', {
    talkId: talk.id,
    answers,
    talkData: talk,
    ...(meta?.withholdFromSender ? { withholdFromSender: true } : {}),
  });

  deps.showNotification(
    talk.type === 'flow'
      ? deps.t('responseSubmittedFlow')
      : talk.type === 'tag'
        ? deps.t('responseSubmittedTag')
        : deps.t('responseSubmittedSurvey'),
    'success',
  );
}
