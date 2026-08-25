import { computeTalkIdFromTalkData } from '../../shared/cid';
import {
  buildAnswerPreferenceLookupKey,
  sessionAnswersToQAPairs,
  type QAPair,
  type TagContext,
} from '../../shared/flattened-answer-keys';
import {
  findTagPairAncestor,
  getRouteRootChildQuestionIds,
  singleNonIgnoreAnswer,
} from '../../shared/talk-engine';
import { pickBuiltInAnswer, resolveBuiltInQuestion } from '../../shared/built-in-question-resolution';
import {
  findAutoAnswer,
  findAutoAnswerMultiple,
  LOCAL_EXACT_CHATBOT_USER_ID,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getTypedPreferenceState,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
} from './answer-preferences-storage';

function effectiveTagContext(
  currentUserId: string | undefined,
  talk: any,
  currentQuestion?: { id: string; contextPath?: Array<{ questionId: string; answerId: string }> },
): { mySelfTag: string | undefined; counterpartCandidates: Array<string | undefined> } {
  const isMine = !!(talk?.authorId && currentUserId && talk.authorId === currentUserId);
  const ancestor = currentQuestion ? findTagPairAncestor(talk, currentQuestion) : undefined;
  if (ancestor) {
    return isMine
      ? { mySelfTag: ancestor.questionText, counterpartCandidates: [ancestor.answerText] }
      : { mySelfTag: ancestor.answerText, counterpartCandidates: [ancestor.questionText] };
  }
  return { mySelfTag: undefined, counterpartCandidates: [undefined] };
}

export function resolveAnswerPreferenceForTalkQuestion(
  currentUserId: string | undefined,
  talk: any,
  questionIndex: number,
  previousQAPairs: QAPair[],
  currentQuestion: {
    id: string;
    text?: string;
    answers?: any[];
    answerSelectionMode?: string;
    builtIn?: any;
    contextPath?: Array<{ questionId: string; answerId: string }>;
    reciprocalTagContext?: boolean;
  },
  talkInstanceId: string,
): {
  answerId: string;
  answerText: string;
  mode: string;
  questionText?: string;
  allAnswers?: any[];
  autoAnswerAction?: string;
  autoAnswerReason?: string;
  /** Spec §3.4 FR-QA-15/16, §30.8: present only when `currentQuestion.answerSelectionMode ===
   *  'multiple'` and the chatbot resolved a non-empty checked set. `answerId` above is always
   *  `answerIds[0]`, kept for callers that only look at the single-value shape. */
  answerIds?: string[];
} | null {
  // §BB / spec §30.2: a builtIn (typed comparison) question is dispatched entirely separately
  // from the exact-text paths below — its 2 answers are app-generated placeholder text
  // ("Compatible"/"Not compatible", see TalkAutofix.fix), never something to memorize or
  // reuse via string equality. Must run BEFORE the multi-select/single-select branches so a
  // builtIn question never falls through to exact-text lookup by mistake.
  if (currentQuestion.builtIn) {
    // Same Pair-tag-ancestor derivation every other tag-context consumer uses (§LL follow-up)
    // — mySelfTag is MY OWN declared side, counterpartCandidates[0] is the incoming talk's own
    // declared side (needed for the quantity want/have direction).
    const { mySelfTag, counterpartCandidates } = effectiveTagContext(currentUserId, talk, currentQuestion);
    const resolution = resolveBuiltInQuestion(
      { myTag: mySelfTag, theirTag: counterpartCandidates[0], title: talk?.title },
      { builtIn: currentQuestion.builtIn, text: currentQuestion.text || '' },
      getTypedPreferenceState(),
      LOCAL_EXACT_CHATBOT_USER_ID,
    );
    if (resolution.action === 'ASK_USER') return null;
    const chosen = pickBuiltInAnswer(currentQuestion.answers, currentQuestion.id, resolution);
    if (!chosen?.id) return null;
    return {
      answerId: chosen.id,
      answerText: String(chosen.text || ''),
      mode: 'auto',
      questionText: currentQuestion.text || '',
      allAnswers: currentQuestion.answers || [],
      autoAnswerAction: 'ANSWER',
      autoAnswerReason: resolution.compatible ? 'BUILT_IN_COMPATIBLE' : 'BUILT_IN_INCOMPATIBLE',
    };
  }

  // docs/TODO.md §LL follow-up: a reciprocalTagContext question with exactly one real answer
  // has no actual decision to make — checking the box at authoring time already declared the
  // whole (question, answer) pair, mirroring how a tag-type talk's single match-answer is
  // always trivially "selectable" (§LL). Auto-proceed unconditionally rather than requiring a
  // flattened-store/exact-text memory hit — that hit would be structurally impossible for the
  // FIRST such question on a branch, whose own text differs from anything the responder has
  // ever answered before (that's the whole point of a "buy" root auto-resolving against a
  // "sell" root: the two sides never share literal text for THIS question, only downstream).
  const reciprocalOnlyAnswer = currentQuestion.reciprocalTagContext
    ? singleNonIgnoreAnswer(currentQuestion)
    : undefined;
  if (reciprocalOnlyAnswer) {
    const only = reciprocalOnlyAnswer;
    return {
      answerId: only.id,
      answerText: String(only.text || ''),
      mode: 'auto',
      questionText: currentQuestion.text || '',
      allAnswers: currentQuestion.answers || [],
      autoAnswerAction: 'ANSWER',
      autoAnswerReason: 'RECIPROCAL_TAG_CONTEXT',
    };
  }

  const currentOptions = (currentQuestion.answers || []).map((answer: any) => String(answer?.text || ''));
  const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
  const isMultiSelect = currentQuestion.answerSelectionMode === 'multiple';
  // docs/TODO.md §LL follow-up: findAutoAnswer/findAutoAnswerMultiple run their own
  // independent PREFERENCE_CONFLICT veto (exact-chatbot-memory.ts), separate from
  // checkIfMatch's (talk-engine.ts). Only a Pair-tag ancestor on THIS branch ever supplies a
  // preference set now (the old talk-root `preferenceSet` fallback is gone) — so the chatbot
  // can't auto-answer past a mid-tree pair-tag conflict that manual answering would veto.
  const tagPairAncestor = findTagPairAncestor(talk, currentQuestion);
  const effectivePreferenceSet: string[] | undefined = tagPairAncestor
    ? [tagPairAncestor.answerText]
    : undefined;

  // §KK: context-aware flattened lookup, tried BEFORE exact-chatbot-memory (was the reverse —
  // exact-chatbot-memory is keyed by question text alone, no context, so it used to win on any
  // hit even when the correct, context-matched flattened entry was sitting right there unused).
  // Single-select only: the flattened store has no concept of a checked set (see the
  // multi-select branch below, unchanged). Translates the stored answer back to THIS talk's
  // OWN answer id by TEXT, not by the stored `answerId` — the flattened entry may have been
  // saved under a different, independently-authored talk whose answer ids don't line up.
  if (!isMultiSelect && currentQuestion.text && currentOptions.length > 0) {
    const { mySelfTag, counterpartCandidates } = effectiveTagContext(currentUserId, talk, currentQuestion);
    const talkContentHash = computeTalkIdFromTalkData(talk);
    const flatMap = getFlattenedAnswerPreferences();
    // Spec §30.2/§KK zero-click follow-up: a matchThreshold route's direct-child specs are
    // independent and order-independent by construction (talk-engine.ts) — the accumulated
    // sibling-answer history that `previousQAPairs` would otherwise carry is irrelevant (and
    // actively harmful: it would make the Model spec's lookup key depend on whichever specs
    // happened to be answered before it, so two independently-authored talks walking specs in
    // a different order would never share a bucket). Always resolve these questions with an
    // empty context path, same key shape as a talk's very first question.
    const effectivePreviousQAPairs = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
      ? []
      : previousQAPairs;
    for (const counterpartTag of counterpartCandidates) {
      const tagContext: TagContext = { mySelfTag, counterpartTag };
      const flatKey = buildAnswerPreferenceLookupKey(
        talk,
        talkContentHash,
        questionIndex,
        effectivePreviousQAPairs,
        currentQuestion.text,
        tagContext,
      );
      const flat = flatMap[flatKey];
      if (!flat) continue;
      const matchingAnswer = (currentQuestion.answers || []).find(
        (answer: any) => String(answer?.text || '').trim() === String(flat.answerText || '').trim(),
      );
      if (matchingAnswer?.id) {
        return {
          answerId: matchingAnswer.id,
          answerText: String(matchingAnswer.text || flat.answerText),
          mode: flat.mode === 'temporary' ? 'auto' : flat.mode,
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: 'ANSWER',
          autoAnswerReason: 'FLATTENED_CONTEXT_MATCH',
        };
      }
    }
  }

  const exactMemory = getExactChatbotMemory();
  if (currentQuestion.text && currentOptions.length > 0 && isMultiSelect) {
    const exact = findAutoAnswerMultiple(
      exactMemory,
      LOCAL_EXACT_CHATBOT_USER_ID,
      currentQuestion.text,
      currentOptions,
      undefined,
      languageContext,
      effectivePreferenceSet,
    );
    setExactChatbotMemory(exactMemory);
    if (exact.action === 'ASK_USER' && exact.reason === 'PREFERENCE_CONFLICT') {
      return null;
    }
    if (exact.action === 'SKIP') {
      return {
        answerId: 'ignore',
        answerText: 'ignore',
        mode: 'auto',
        questionText: currentQuestion.text || '',
        allAnswers: currentQuestion.answers || [],
        autoAnswerAction: exact.action,
        autoAnswerReason: exact.reason,
      };
    }
    if (exact.action === 'ANSWER' && exact.answerIds && exact.answerIds.length > 0) {
      // exact.answerIds are content-hash ids (makeAnswerId, exact-chatbot-memory.ts) — this
      // TALK's own Answer.id fields are positional ("a_0_0", ...), a different scheme
      // entirely (same translation the single-select ANSWER branch above already does via
      // text comparison). Map each remembered text back to this talk's own answer id.
      const exactTexts = exact.answerTexts || [];
      const matchedAnswerIds: string[] = [];
      const matchedTexts: string[] = [];
      for (const answerText of exactTexts) {
        const matchingAnswer = (currentQuestion.answers || []).find((answer: any) => {
          return String(answer?.text || '').trim() === answerText;
        });
        if (matchingAnswer?.id) {
          matchedAnswerIds.push(matchingAnswer.id);
          matchedTexts.push(String(matchingAnswer.text || answerText));
        }
      }
      if (matchedAnswerIds.length > 0) {
        return {
          answerId: matchedAnswerIds[0],
          answerIds: matchedAnswerIds,
          answerText: matchedTexts.join(', '),
          mode: 'auto',
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: exact.action,
          autoAnswerReason: exact.reason,
        };
      }
    }
    // No resolvable multi-select preference — the flattened/legacy stores below were built
    // for single-value answers and have no concept of a checked set, so a multi-select
    // question that doesn't resolve here falls straight to manual human answering (§30.4's
    // fail-safe: no stored preference → ask, never guess or partially resolve).
    return null;
  }
  if (currentQuestion.text && currentOptions.length > 0) {
    const exact = findAutoAnswer(
      exactMemory,
      LOCAL_EXACT_CHATBOT_USER_ID,
      currentQuestion.text,
      currentOptions,
      undefined,
      languageContext,
      effectivePreferenceSet,
    );
    setExactChatbotMemory(exactMemory);
    // A preference-set conflict is an absolute veto — do not fall through to the weaker
    // flattened/legacy preference lookups below, which aren't preference-aware and could
    // otherwise resolve an answer via stale per-talk-instance history.
    if (exact.action === 'ASK_USER' && exact.reason === 'PREFERENCE_CONFLICT') {
      return null;
    }
    if (exact.action === 'SKIP') {
      return {
        answerId: 'ignore',
        answerText: 'ignore',
        mode: 'auto',
        questionText: currentQuestion.text || '',
        allAnswers: currentQuestion.answers || [],
        autoAnswerAction: exact.action,
        autoAnswerReason: exact.reason,
      };
    }
    if (exact.action === 'ANSWER' && exact.answerText) {
      const matchingAnswer = (currentQuestion.answers || []).find((answer: any) => {
        return String(answer?.text || '').trim() === exact.answerText;
      });
      if (matchingAnswer?.id) {
        return {
          answerId: matchingAnswer.id,
          answerText: String(matchingAnswer.text || exact.answerText),
          mode: 'auto',
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: exact.action,
          autoAnswerReason: exact.reason,
        };
      }
    }
  }

  // Last resort: resume MY OWN prior answer to this exact talk instance (same id namespace,
  // no translation needed) — the §KK flattened lookup above already covers the cross-talk case.
  const preferences = getAnswerPreferences();
  const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
  return preferences[legacyKey] || null;
}

export function saveAnswerPreference(
  currentUserId: string | undefined,
  talk: any,
  talkInstanceId: string,
  currentQuestion: { id: string; text?: string; answers?: any[]; contextPath?: Array<{ questionId: string; answerId: string }> },
  answerId: string,
  answerText: string,
  fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
  mode: 'auto' | 'manual' | 'permanent' | 'suppressed' = 'auto',
): void {
  const exactMemory = getExactChatbotMemory();
  const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
  // The selfTag to persist alongside this answer is always MY OWN effective tag for this
  // deal, derived from the nearest Pair-tag ancestor (`myEffectiveTagContext`, §LL follow-up)
  // — this lets findAutoAnswer/getSelfTagForQuestionText later veto a preference mismatch
  // without every call site here having to know or pass that distinction explicitly. §KK:
  // also drives the flattened-store write below.
  const { mySelfTag, counterpartCandidates } = effectiveTagContext(currentUserId, talk, currentQuestion);
  if (currentQuestion.text) {
    if (mode === 'suppressed') {
      saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, undefined, languageContext);
    } else if (mode === 'permanent') {
      savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag);
    } else if (mode === 'auto') {
      saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag);
    }
    setExactChatbotMemory(exactMemory);
  }

  const preferences = getAnswerPreferences();
  const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
  const talkContentHash = computeTalkIdFromTalkData(talk);
  const qIndex = Math.max(
    0,
    talk.questions?.findIndex((q: { id: string }) => q.id === currentQuestion.id) ?? 0,
  );
  // Mirrors the read-side override in `resolveAnswerPreferenceForTalkQuestion` — a
  // matchThreshold route's direct-child specs are independent, so their save key must not
  // depend on whichever sibling specs happened to be saved earlier in this loop.
  const previous = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
    ? []
    : sessionAnswersToQAPairs(talk, fullSessionAnswersIncludingCurrent.slice(0, -1));

  // §KK: write the same answer under one flattened-key bucket per counterpart-tag candidate
  // `myEffectiveTagContext` returns — today that's always at most one (the nearest Pair-tag
  // ancestor's own counterpart), but the fan-out shape is kept in case a future context source
  // ever yields more than one candidate.
  const primaryFlatKey = buildAnswerPreferenceLookupKey(
    talk,
    talkContentHash,
    qIndex,
    previous,
    currentQuestion.text || '',
    { mySelfTag, counterpartTag: counterpartCandidates[0] },
  );

  const entry = {
    answerId,
    answerText,
    mode: mode === 'auto' ? 'temporary' : mode,
    language: languageContext.language,
    talkId: talkInstanceId,
    questionText: currentQuestion.text || '',
    allAnswers: currentQuestion.answers || [],
    timestamp: new Date().toISOString(),
    flatKey: primaryFlatKey,
  };

  preferences[legacyKey] = entry;
  setAnswerPreferences(preferences);

  const flatMap = getFlattenedAnswerPreferences();
  for (const counterpartTag of counterpartCandidates) {
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      talkContentHash,
      qIndex,
      previous,
      currentQuestion.text || '',
      { mySelfTag, counterpartTag },
    );
    flatMap[flatKey] = { ...entry, flatKey };
  }
  setFlattenedAnswerPreferences(flatMap);
  console.log('💾 Saved answer (exact + flat + legacy):', primaryFlatKey, answerText, mode);
}

export function tryBuildChatbotAnswersFromFlattened(
  currentUserId: string | undefined,
  talkData: any,
): Array<{ questionId: string; answerId: string; answerText: string; mode?: string; answerIds?: string[] }> | null {
  const questions = talkData?.questions;
  if (!Array.isArray(questions) || questions.length === 0) return null;
  const out: Array<{ questionId: string; answerId: string; answerText: string; mode?: string; answerIds?: string[] }> =
    [];
  const pairs: QAPair[] = [];
  const gunId = talkData.id || '';

  // Spec §30.2/§KK zero-click follow-up: a matchThreshold route has no single "self-answer"
  // for its root (the root's whole point is 3+ parallel specs at once, not one chosen path —
  // matchThreshold mode never asks the respondent to answer it either, see
  // `getRouteRootChildQuestionIds`/talk-response-dialog.ts's multi-branch walk). Resolve only
  // the root's direct-child specs, each independently (no accumulated sibling context —
  // enforced inside `resolveAnswerPreferenceForTalkQuestion`), and skip the root entirely.
  // `checkIfMatch`'s route branch (`computeRouteMatchScore`) only ever reads answers for
  // recognized child-spec ids, so an answer set with no root entry is already exactly the
  // shape it expects.
  const routeChildIds = getRouteRootChildQuestionIds(talkData);
  if (routeChildIds) {
    for (const childId of routeChildIds) {
      const q = questions.find((qq: any) => qq.id === childId);
      if (!q) return null;
      const pref = resolveAnswerPreferenceForTalkQuestion(currentUserId, talkData, questions.indexOf(q), [], q, gunId);
      if (!pref || pref.mode !== 'auto') return null;
      if (pref.answerId === 'ignore') return null;
      const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
      if (!ans) return null;
      out.push({
        questionId: q.id,
        answerId: pref.answerId,
        answerText: pref.answerText,
        mode: 'auto',
      });
    }
    return out;
  }

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const pref = resolveAnswerPreferenceForTalkQuestion(currentUserId, talkData, i, pairs, q, gunId);
    if (!pref || pref.mode !== 'auto') return null;
    if (pref.answerId === 'ignore') return null;
    if (pref.answerIds && pref.answerIds.length > 0) {
      // Spec §3.4 FR-QA-15/16, §30.8: every checked id must be a real option on this
      // question — same fail-safe spirit as the single-value lookup below.
      const allValid = pref.answerIds.every((id) => q.answers?.some((a: { id: string }) => a.id === id));
      if (!allValid) return null;
      out.push({
        questionId: q.id,
        answerId: pref.answerId,
        answerIds: pref.answerIds,
        answerText: pref.answerText,
        mode: 'auto',
      });
      // docs/TODO.md §LL follow-up: mirrors `sessionAnswersToQAPairs`'s own exclusion — a
      // Pair-tag question's (text, answer) differs by construction between independently-
      // authored talks, so it's kept out of the path every later question's flattened lookup
      // key is built from (see that function's doc comment for the full reasoning).
      if (!q.reciprocalTagContext) {
        pairs.push({
          questionText: (q.text || '').trim(),
          answerText: (pref.answerText || '').trim(),
        });
      }
      continue;
    }
    const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
    if (!ans) return null;
    out.push({
      questionId: q.id,
      answerId: pref.answerId,
      answerText: pref.answerText,
      mode: 'auto',
    });
    if (!q.reciprocalTagContext) {
      pairs.push({
        questionText: (q.text || '').trim(),
        answerText: (pref.answerText || '').trim(),
      });
    }
  }
  return out;
}
