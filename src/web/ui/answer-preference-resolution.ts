import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { LocationForContainment } from '../../shared/built-in-comparisons';
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
import { getLocationAutoMatchConsent } from './ui-settings-storage';
import { getMyTalks, type MyTalkMap } from './my-talks-storage';

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

/**
 * §BB: source side "b" of `locationsMutuallyContained` from whatever MY OWN most-recently
 * created talk of matching (selfTag, title) scope already carries as its ordinary
 * `authorLocation`/`locationRadiusMiles` — see `Question.builtIn`'s own doc comment (types.ts)
 * for why location reuses a counterpart talk's fields instead of a separately-typed value like
 * quantity/priceRange/timeFrame. Scoped the same way `typedPreferenceState` is (myTag + title),
 * so two same-titled talks with different tags/locations don't bleed into each other. Pure/
 * synchronous — `myTalks` is the already-loaded `getMyTalks()` map, not read internally, so this
 * is directly unit-testable.
 */
export function myMostRecentLocationTalk(
  myTalks: MyTalkMap,
  currentUserId: string | undefined,
  mySelfTag: string | undefined,
  title: string | undefined,
): LocationForContainment | undefined {
  if (!title) return undefined;
  const normalizedTitle = title.trim().toLowerCase();
  const normalizedTag = String(mySelfTag || 'general');
  let best: { timestamp: string; location: LocationForContainment } | undefined;
  for (const entry of Object.values(myTalks)) {
    if (entry.role !== 'created') continue;
    if (String(entry.title || '').trim().toLowerCase() !== normalizedTitle) continue;
    const fullTalk = entry.fullTalk || entry;
    const questions: any[] = Array.isArray(fullTalk?.questions) ? fullTalk.questions : [];
    const locationQuestion = questions.find((q: any) => q?.builtIn?.kind === 'location');
    if (!locationQuestion) continue;
    const { mySelfTag: ownTag } = effectiveTagContext(currentUserId, fullTalk, locationQuestion);
    if (String(ownTag || 'general') !== normalizedTag) continue;
    const authorLocation = fullTalk?.authorLocation;
    const locationRadiusMiles = entry.locationRadiusMiles ?? fullTalk?.locationRadiusMiles;
    if (!authorLocation || locationRadiusMiles == null) continue;
    if (!best || entry.timestamp > best.timestamp) {
      best = { timestamp: entry.timestamp, location: { authorLocation, locationRadiusMiles } };
    }
  }
  return best?.location;
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
    // §BB: only ever supply real location data when the user has explicitly opted in — omitting
    // it when consent is withheld keeps resolveBuiltInQuestion's own missing-data ASK_USER
    // fallback as the single source of truth for "not resolvable," rather than duplicating a
    // consent check inside that (deliberately consent-agnostic, pure) function.
    const locationContext = currentQuestion.builtIn?.kind === 'location' && getLocationAutoMatchConsent()
      ? {
          myLocation: myMostRecentLocationTalk(getMyTalks(), currentUserId, mySelfTag, talk?.title),
          theirLocation: { authorLocation: talk?.authorLocation, locationRadiusMiles: talk?.locationRadiusMiles },
        }
      : {};
    const resolution = resolveBuiltInQuestion(
      { myTag: mySelfTag, theirTag: counterpartCandidates[0], title: talk?.title, ...locationContext },
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

  // Walk the real DAG (root -> nextQuestionId chains -> nextQuestionIds fan-out), not a flat
  // `questions[]` array-order loop — the loop this replaced never followed either field, so it
  // only ever happened to work by coincidence: every existing talk-generation path (the route
  // DSL's `flattenRouteTree`, and flow's own linear authoring) always emits `questions[]` in a
  // valid depth-first visit order already. It stopped being coincidentally correct for a
  // fan-out talk whose parallel branches must each get their OWN ancestor-context `pairs` (not
  // one shared list polluted by sibling branches) — found via docs/TODO.md §DD's Dating
  // multi-gender rework, but the fix is general: any branching route needs this, not just
  // Dating. `visitedQids` is a defensive cycle backstop only (route talks are validated as a
  // DAG, `TalkValidator.validateDAGStructure`).
  const byId = new Map(questions.map((q: any, i: number) => [q.id, { q, i }]));
  const usesContextPath = questions.some((q: any) => Array.isArray(q.contextPath));
  const root = usesContextPath
    ? questions.find((q: any) => Array.isArray(q.contextPath) && q.contextPath.length === 0)
    : questions[0];
  if (!root) return null;

  const visit = (q: any, branchPairs: QAPair[], visitedQids: Set<string>): boolean => {
    if (visitedQids.has(q.id)) return false;
    const entry = byId.get(q.id);
    if (!entry) return false;
    const pref = resolveAnswerPreferenceForTalkQuestion(currentUserId, talkData, entry.i, branchPairs, q, gunId);
    if (!pref || pref.mode !== 'auto') return false;
    if (pref.answerId === 'ignore') return false;
    const nextVisited = new Set(visitedQids).add(q.id);

    if (pref.answerIds && pref.answerIds.length > 0) {
      // Spec §3.4 FR-QA-15/16, §30.8: every checked id must be a real option on this
      // question — same fail-safe spirit as the single-value lookup below.
      const allValid = pref.answerIds.every((id) => q.answers?.some((a: { id: string }) => a.id === id));
      if (!allValid) return false;
      out.push({
        questionId: q.id,
        answerId: pref.answerId,
        answerIds: pref.answerIds,
        answerText: pref.answerText,
        mode: 'auto',
      });
      // Multi-select is always chain-terminal (§30.8) — no nextQuestionId(s) of its own.
      return true;
    }

    const ans = q.answers?.find((a: { id: string }) => a.id === pref.answerId);
    if (!ans) return false;
    out.push({
      questionId: q.id,
      answerId: pref.answerId,
      answerText: pref.answerText,
      mode: 'auto',
    });
    // docs/TODO.md §LL follow-up: mirrors `sessionAnswersToQAPairs`'s own exclusion — a
    // Pair-tag question's (text, answer) differs by construction between independently-
    // authored talks, so it's kept out of the path every later question's flattened lookup
    // key is built from (see that function's doc comment for the full reasoning).
    const nextPairs = q.reciprocalTagContext
      ? branchPairs
      : [...branchPairs, { questionText: (q.text || '').trim(), answerText: (pref.answerText || '').trim() }];

    if (Array.isArray(ans.nextQuestionIds) && ans.nextQuestionIds.length > 0) {
      // Fan-out: visit every parallel child, each starting from the SAME ancestor context —
      // whether enough of them individually "pass" is `checkIfMatch`/`evaluateRouteFanOutMatch`'s
      // job afterward, not this walk's. A child that can't be auto-answered just isn't included
      // in `out` — same "unanswered spec counts as not-passed" tolerance the fan-out scorer
      // already has (talk-engine.test.ts), not a reason to abort the whole build.
      for (const childId of ans.nextQuestionIds) {
        const child = byId.get(childId)?.q;
        if (child) visit(child, nextPairs, nextVisited);
      }
      return true;
    }
    if (ans.nextQuestionId) {
      const child = byId.get(ans.nextQuestionId)?.q;
      if (child) return visit(child, nextPairs, nextVisited);
    }
    return true;
  };

  if (!visit(root, pairs, new Set())) return null;
  return out;
}
