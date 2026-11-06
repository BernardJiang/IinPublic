import { getMyTalks, setMyTalks } from './my-talks-storage';
import {
  formatTypedAnswerValue,
  typedAnswerValueFromBuiltIn,
  type TypedAnswerValue,
} from '../../shared/typed-preference-store';

export type SaveCreatedTalkDeps = {
  currentUserId?: string | undefined;
  saveFlatAnswerHistoryRecord: (
    talkId: string,
    talk: any,
    completedAnswers: Array<{
      questionId: string;
      answerId: string;
      answerText?: string;
      mode?: string;
      typedValue?: TypedAnswerValue;
    }>,
    outcome: 'match' | 'mismatch',
    senders: string[],
  ) => void;
  /** Re-renders the talks list only when it's the currently active view. */
  refreshTalksListIfActive: () => void;
  /** Re-renders newly persisted typed declarations when the Me view is active. */
  refreshAnswersListIfActive: () => void;
};

/**
 * Stores a successfully created/updated authored talk in `myTalks` and, for each self-answer
 * the author gave, cascades that answer through the same preference/history stores a real
 * completion would (chatbot auto-reply, flat answer history) — an author's own self-answers
 * are otherwise invisible to those stores.
 */
export function saveCreatedTalk(
  talk: { id: string; title: string; type: string; questions: any[]; language?: string; expiresAt?: number | null; locationRadiusMiles?: number | null; collectionImportance?: 'important' | 'must-have' },
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
    collectionImportance: talk.collectionImportance,
    lastInteraction: new Date().toISOString(),
  };
  setMyTalks(myTalks);

  // My self-answers and built-in values are my answer to my own Talk: its history record goes
  // into the device graph, where the chatbot reuses them (`app-answers.ts`, OPEN-106 step 2e v).
  const completedAnswers: Array<{
    questionId: string;
    answerId: string;
    answerText?: string;
    mode?: string;
    typedValue?: TypedAnswerValue;
  }> = [];
  let hasMatchAnswer = false;
  for (const { questionId, answerId } of options.selfAnswers) {
    const q = talk.questions?.find((qu: any) => qu.id === questionId);
    const a = q?.answers?.find((an: any) => an.id === answerId);
    if (!a) continue;
    completedAnswers.push({ questionId, answerId, answerText: a.text || '', mode: 'manual' });
    if (a.isMatch === true) hasMatchAnswer = true;
  }
  // §EE: a typed value authored on my own question is an ordinary Me-tab answer declaration.
  for (const q of talk.questions || []) {
    if (!q?.builtIn) continue;
    const typedValue = typedAnswerValueFromBuiltIn(q.builtIn);
    if (!typedValue) continue;
    completedAnswers.push({
      questionId: q.id,
      answerId: `typed:${typedValue.kind}`,
      answerText: formatTypedAnswerValue(typedValue),
      mode: 'typed',
      typedValue,
    });
  }

  if (completedAnswers.length > 0) {
    deps.saveFlatAnswerHistoryRecord(talk.id, talk, completedAnswers, hasMatchAnswer ? 'match' : 'mismatch', []);
    if (document.getElementById('me-view')?.classList.contains('active')) {
      deps.refreshAnswersListIfActive();
    }
  }

  const talksView = document.getElementById('talks-view');
  if (talksView?.classList.contains('active')) {
    deps.refreshTalksListIfActive();
  }
}
