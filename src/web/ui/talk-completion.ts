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
  meta: { withholdFromSender?: boolean; forceCopyToMyTalks?: boolean; answeredByChatbot?: boolean } | undefined,
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
  // The app's dedicated talk-level Ignore action uses this exact sentinel. Do not confuse it
  // with an author-written answer whose id/text happens to contain the word "ignore".
  const wasIgnored = answers.some((answer) => String(answer?.answerId || '').toLowerCase() === 'ignore');
  const role = wasIgnored ? 'ignored'
             : existingEntry?.role === 'copied' ? 'copied'
             : existingEntry?.role === 'created' ? 'created'
             : meta?.forceCopyToMyTalks && !wasIgnored ? 'copied'
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
    roleBeforeIgnore: wasIgnored
      ? existingEntry?.role === 'ignored'
        ? existingEntry.roleBeforeIgnore
        : existingEntry?.role
      : undefined,
    // docs/TODO.md §Y1: auto-copy on completion is still just a copy — original authorship
    // is preserved either way until a real edit happens.
    fullTalk: existingTalkId && myTalks[existingTalkId]?.fullTalk ? myTalks[existingTalkId].fullTalk : talk,
    completedAnswers,
    outcome: outcome ?? existingEntry?.outcome ?? 'mismatch',
    // A manual answer replaces (and so clears) an earlier chatbot answer's marker.
    answeredBy: meta?.answeredByChatbot ? 'chatbot' : undefined,
    senders,
  }, deps);
  // Ignore is a talk-list state, not an answer. Keep it out of the normal Me-tab Q&A history;
  // the dedicated Ignored list is the one place where it should remain visible.
  if (!wasIgnored) {
    saveFlatAnswerHistoryRecord(
      talkIdToUse, talk, completedAnswers, outcome ?? existingEntry?.outcome ?? 'mismatch', senders,
      meta?.answeredByChatbot ? { answeredBy: 'chatbot' } : {},
    );
  }

  // The chatbot already sent its response to the author; this call only records it locally,
  // quietly — the user did nothing, and the 🤖 marker on the row is the record.
  if (meta?.answeredByChatbot) {
    deps.displayTalksList();
    return;
  }

  deps.emit('talkCompleted', {
    talkId: talk.id,
    answers,
    talkData: talk,
    ...(meta?.withholdFromSender ? { withholdFromSender: true } : {}),
  });

  deps.showNotification(
    wasIgnored
      ? deps.t('talksIgnored')
      : talk.type === 'flow'
      ? deps.t('responseSubmittedFlow')
      : talk.type === 'tag'
        ? deps.t('responseSubmittedTag')
        : deps.t('responseSubmittedSurvey'),
    wasIgnored ? 'info' : 'success',
  );
}

/**
 * OPEN-45: an author's title/routing-only edit arrives as the same content (same identity). When
 * this device already answered (or retained / ignored) that content from that author, refresh the
 * stored copy in place — new title, new routing — keeping the answers, which still apply to the
 * unchanged questions. Returns true when it was such an update (the caller then stays quiet: it is
 * not a new talk and nothing needs doing).
 */
export function applyTalkRevisionToAnsweredCopy(talk: any, authorId: string): boolean {
  let contentId = '';
  try {
    contentId = computeTalkIdFromTalkData(talk);
  } catch {
    return false;
  }
  const answeredTalkId = getAnsweredTalkByContent()[contentId];
  const myTalks = getMyTalks();
  const entry = answeredTalkId ? myTalks[answeredTalkId] : undefined;
  if (!entry || !authorId || !(entry.senders || []).includes(authorId)) return false;
  if (entry.role === 'created') return false;
  myTalks[answeredTalkId!] = {
    ...entry,
    title: String(talk?.title || entry.title),
    fullTalk: entry.fullTalk ? { ...entry.fullTalk, ...talk, id: entry.fullTalk.id ?? talk?.id } : talk,
  };
  setMyTalks(myTalks);
  return true;
}
