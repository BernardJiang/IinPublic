import { getMyTalks, setMyTalks } from './my-talks-storage';
import { findTagPairAncestor } from '../../shared/talk-engine';
import {
  formatTypedAnswerValue,
  makeTypedPreferenceScopeKey,
  saveTypedPreference,
  typedAnswerValueFromBuiltIn,
  typedPreferenceQuestionContext,
  type TypedAnswerValue,
} from '../../shared/typed-preference-store';
import { LOCAL_EXACT_CHATBOT_USER_ID } from '../../shared/exact-chatbot-memory';
import { immediateParentQAPairs } from '../../shared/flattened-answer-keys';
import { getTypedPreferenceState, setTypedPreferenceState } from './answer-preferences-storage';
import { resolveAnswerPreferenceForTalkQuestion } from './answer-preference-resolution';

export type SaveCreatedTalkDeps = {
  /** The author's own user id — needed to resolve a `builtIn` ancestor (see the pre-pass in
   *  `saveCreatedTalk` below); `saveAnswerPreference`/`resolveAnswerPreferenceForTalkQuestion`
   *  already take it everywhere else they're called, this just plumbs the same value here. */
  currentUserId?: string | undefined;
  /** Persists one self-answer for chatbot/auto-reply (bound to the current user id). */
  saveAnswerPreference: (
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[] },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerId?: string; answerText?: string; contextHash?: string }>,
    mode: 'auto' | 'manual' | 'permanent' | 'suppressed',
  ) => string;
  saveQuestionAnswersFromCompletion: (
    talkData: { questions?: Array<{ id: string; text?: string }> },
    answers: Array<{ questionId: string; answerId: string; answerText?: string }>,
  ) => void;
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
  const acc: Array<{ questionId: string; answerId?: string; answerText?: string; contextHash?: string }> = [];
  const completedAnswers: Array<{
    questionId: string;
    answerId: string;
    answerText?: string;
    mode?: string;
    typedValue?: TypedAnswerValue;
  }> = [];
  let hasMatchAnswer = false;

  // Seed typedPreferenceState from the author's own builtIn declarations (e.g. "I'm 28, OK with
  // 21-45") BEFORE the builtIn-root resolution pre-pass below needs to read it back —
  // `resolveBuiltInQuestion` can only answer "Compatible" for MY OWN talk's root once this
  // exists. The full typed-value pass further down (completedAnswers/display, unchanged in
  // position so Me-tab ordering doesn't shift) redundantly re-saves the identical value; that
  // second write is a harmless no-op, not a correctness concern.
  for (const q of talk.questions || []) {
    if (!q?.builtIn) continue;
    const typedValue = typedAnswerValueFromBuiltIn(q.builtIn);
    if (!typedValue) continue;
    const preferenceStateEarly = getTypedPreferenceState();
    const myTagEarly = findTagPairAncestor(talk as any, q)?.questionText;
    const scopeKeyEarly = makeTypedPreferenceScopeKey(
      String(myTagEarly || 'general'),
      talk.title,
      q.text,
      typedPreferenceQuestionContext(talk, q),
    );
    saveTypedPreference(preferenceStateEarly, LOCAL_EXACT_CHATBOT_USER_ID, scopeKeyEarly, {
      ...typedValue,
      sourceTalkId: talk.id,
      sourceQuestionId: q.id,
    });
    setTypedPreferenceState(preferenceStateEarly);
  }

  // A `builtIn` root (ageRange/typed comparison — the Dating/Roommate/PetSitting/Tutor template
  // shape) never appears in `options.selfAnswers`: `buildRouteSelfAnswers` (route-editor-model.ts)
  // deliberately never records a self-answer for one ("a built-in node has no authored self-
  // answer"), since its resolution is dynamic (`resolveBuiltInQuestion`), not a stored choice.
  // Left unresolved here, a descendant Pair-tag branch past it can never recover this root as its
  // rolling-context ancestor (`immediateParentQAPairs` can only see what's actually in `acc`) —
  // the chatbot would then be unable to auto-match through that branch on ANY device, including
  // this one, even though the live incoming-talk resolver (`tryBuildChatbotAnswersFromFlattened`)
  // resolves the identical root fine by itself. Resolve it the same deterministic way here and
  // seed `acc` with it before the self-answers below, so both paths hash the same context.
  for (const q of talk.questions || []) {
    if (!q?.builtIn || (Array.isArray(q.contextPath) && q.contextPath.length > 0)) continue;
    const index = talk.questions.indexOf(q);
    const previousQAPairs = immediateParentQAPairs(talk, q, acc);
    const pref = resolveAnswerPreferenceForTalkQuestion(deps.currentUserId, talk, index, previousQAPairs, q, talk.id);
    if (!pref || pref.mode !== 'auto') continue;
    const sessionAnswer: { questionId: string; answerId?: string; answerText?: string; contextHash?: string } = {
      questionId: q.id,
      answerId: pref.answerId,
      answerText: pref.answerText,
    };
    acc.push(sessionAnswer);
    sessionAnswer.contextHash = deps.saveAnswerPreference(talk, talk.id, q, pref.answerId, pref.answerText, acc, 'auto');
  }

  for (const { questionId, answerId } of options.selfAnswers) {
    const q = talk.questions?.find((qu: any) => qu.id === questionId);
    if (!q) continue;
    const a = q.answers?.find((an: any) => an.id === answerId);
    if (!a) continue;
    const sessionAnswer: { questionId: string; answerId?: string; answerText?: string; contextHash?: string } = {
      questionId,
      answerId: a.id,
      answerText: a.text,
    };
    acc.push(sessionAnswer);
    completedAnswers.push({
      questionId,
      answerId,
      answerText: a.text || '',
      mode: 'manual',
    });
    if (a.isMatch === true) hasMatchAnswer = true;
    sessionAnswer.contextHash = deps.saveAnswerPreference(talk, talk.id, q, a.id, a.text || '', acc, 'auto');
  }

  // §EE: a typed value authored on my own question is an ordinary Me-tab answer declaration,
  // even though it has no author-selectable Compatible/Not-compatible outcome. Persist the
  // structured value on the same flat AnswerRecord used by every other Me answer, and maintain
  // typedPreferenceState only as the resolver's lookup index.
  const preferenceState = getTypedPreferenceState();
  const localScopes = preferenceState.users[LOCAL_EXACT_CHATBOT_USER_ID] || {};
  for (const [scopeKey, value] of Object.entries(localScopes)) {
    if (value.sourceTalkId === talk.id) delete localScopes[scopeKey];
  }
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
    const myTag = findTagPairAncestor(talk as any, q)?.questionText;
    const scopeKey = makeTypedPreferenceScopeKey(
      String(myTag || 'general'),
      talk.title,
      q.text,
      typedPreferenceQuestionContext(talk, q),
    );
    saveTypedPreference(preferenceState, LOCAL_EXACT_CHATBOT_USER_ID, scopeKey, {
      ...typedValue,
      sourceTalkId: talk.id,
      sourceQuestionId: q.id,
    });
  }
  setTypedPreferenceState(preferenceState);

  if (completedAnswers.length > 0) {
    const ordinaryAnswers = completedAnswers.filter((answer) => !answer.typedValue);
    if (ordinaryAnswers.length > 0) deps.saveQuestionAnswersFromCompletion(talk, ordinaryAnswers);
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
