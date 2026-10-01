import type { LocationForContainment } from '../../shared/built-in-comparisons';
import { normalizeIdentityText } from '../../shared/cid';
import {
  ANSWER_CONTEXT_VERSION,
  buildAnswerPreferenceLookupKey,
  immediateParentQAPairs,
  type QAPair,
} from '../../shared/flattened-answer-keys';
import {
  findTagPairAncestor,
  getRouteRootChildQuestionIds,
  singleNonIgnoreAnswer,
} from '../../shared/talk-engine';
import { pickBuiltInAnswer, resolveBuiltInQuestion } from '../../shared/built-in-question-resolution';
import { typedPreferenceQuestionContext } from '../../shared/typed-preference-store';
import {
  LOCAL_EXACT_CHATBOT_USER_ID,
  savePermanentAnswer,
  saveSuppressedQuestion,
  saveTemporaryAnswer,
} from '../../shared/exact-chatbot-memory';
import {
  buildAnswerIdentityHash,
  buildQuestionDefaultKey,
  putQuestionDefault,
  resolveQuestionDefault,
} from '../../shared/question-default-contracts';
import {
  getAnswerPreferences,
  getExactChatbotMemory,
  getFlattenedAnswerPreferences,
  getQuestionDefaultContracts,
  getTypedPreferenceState,
  setAnswerPreferences,
  setExactChatbotMemory,
  setFlattenedAnswerPreferences,
  setQuestionDefaultContracts,
} from './answer-preferences-storage';
import { getLocationAutoMatchConsent } from './ui-settings-storage';
import { getMyTalks, type MyTalkMap } from './my-talks-storage';

function effectiveTagContext(
  currentUserId: string | undefined,
  talk: any,
  currentQuestion?: { id: string; contextPath?: Array<{ questionId: string; answerId: string }> },
): { mySelfTag: string | undefined; counterpartCandidates: Array<string | undefined>; isMine: boolean } {
  const isMine = !!(talk?.authorId && currentUserId && talk.authorId === currentUserId);
  const ancestor = currentQuestion ? findTagPairAncestor(talk, currentQuestion) : undefined;
  if (ancestor) {
    return isMine
      ? { mySelfTag: ancestor.questionText, counterpartCandidates: [ancestor.answerText], isMine }
      : { mySelfTag: ancestor.answerText, counterpartCandidates: [ancestor.questionText], isMine };
  }
  return { mySelfTag: undefined, counterpartCandidates: [undefined], isMine };
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
  /** Version-2 rolling context for this exact question and complete choice set. */
  contextHash?: string;
  /** Spec §3.4 FR-QA-15/16, §30.8: present only when `currentQuestion.answerSelectionMode ===
   *  'multiple'` and the chatbot resolved a non-empty checked set. `answerId` above is always
   *  `answerIds[0]`, kept for callers that only look at the single-value shape. */
  answerIds?: string[];
} | null {
  const { mySelfTag, counterpartCandidates } = effectiveTagContext(currentUserId, talk, currentQuestion);
  const effectivePreviousQAPairs = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
    ? []
    : previousQAPairs;
  const contextKeyFor = (counterpartTag: string | undefined): string => buildAnswerPreferenceLookupKey(
    talk,
    '',
    questionIndex,
    effectivePreviousQAPairs,
    currentQuestion.text || '',
    { mySelfTag, counterpartTag },
    currentQuestion,
  );
  const rootContextKeyFor = (counterpartTag: string | undefined): string => buildAnswerPreferenceLookupKey(
    talk,
    '',
    questionIndex,
    [],
    currentQuestion.text || '',
    { mySelfTag, counterpartTag },
    currentQuestion,
  );
  const primaryContextHash = contextKeyFor(counterpartCandidates[0]).replace(/^flat_v\d+_/, '');

  // §BB / spec §30.2: a builtIn (typed comparison) question is dispatched entirely separately
  // from the exact-text paths below — its 2 answers are app-generated placeholder text
  // ("Compatible"/"Not compatible", see TalkAutofix.fix), never something to memorize or
  // reuse via string equality. Must run BEFORE the multi-select/single-select branches so a
  // builtIn question never falls through to exact-text lookup by mistake.
  if (currentQuestion.builtIn) {
    // Same Pair-tag-ancestor derivation every other tag-context consumer uses (§LL follow-up)
    // — mySelfTag is MY OWN declared side, counterpartCandidates[0] is the incoming talk's own
    // declared side (needed for the quantity want/have direction).
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
      {
        myTag: mySelfTag,
        theirTag: counterpartCandidates[0],
        title: talk?.title,
        questionContext: typedPreferenceQuestionContext(talk, currentQuestion),
        ...locationContext,
      },
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
      contextHash: primaryContextHash,
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
      contextHash: primaryContextHash,
    };
  }

  const isMultiSelect = currentQuestion.answerSelectionMode === 'multiple';

  // Ordinary chatbot memory has two deliberately narrow levels. A saved answer for this exact
  // rolling context wins first. If there is no such reusable answer, a ROOT answer for the same
  // complete question frame acts as the user's unconditional default at any later sequential
  // position. This is still exact matching: question text, complete order-independent choice
  // set, language, talk type, selection mode, and Pair-tag scope must all be identical.
  if (!isMultiSelect && currentQuestion.text && (currentQuestion.answers || []).length > 0) {
    const flatMap = getFlattenedAnswerPreferences();
    // Spec §30.2/§KK zero-click follow-up: a matchThreshold route's direct-child specs are
    // independent and order-independent by construction (talk-engine.ts) — the accumulated
    // sibling-answer history that `previousQAPairs` would otherwise carry is irrelevant (and
    // actively harmful: it would make the Model spec's lookup key depend on whichever specs
    // happened to be answered before it, so two independently-authored talks walking specs in
    // a different order would never share a bucket). Always resolve these questions with an
    // empty context path, same key shape as a talk's very first question.
    const resolveFlatKey = (
      flatKey: string,
      autoAnswerReason: 'KNOWN_CONTEXT_MATCH' | 'KNOWN_ROOT_CONTEXT_MATCH',
      responseContextHash = flatKey.replace(/^flat_v\d+_/, ''),
    ) => {
      const flat = flatMap[flatKey];
      if (!flat || flat.contextVersion !== ANSWER_CONTEXT_VERSION || !flat.contextHash) return null;
      const matchingAnswer = (currentQuestion.answers || []).find(
        (answer: any) => normalizeIdentityText(answer?.text) === normalizeIdentityText(flat.answerText),
      );
      if (matchingAnswer?.id) {
        return {
          answerId: matchingAnswer.id,
          answerText: String(matchingAnswer.text || flat.answerText),
          mode: flat.mode === 'temporary' ? 'auto' : flat.mode,
          questionText: currentQuestion.text || '',
          allAnswers: currentQuestion.answers || [],
          autoAnswerAction: 'ANSWER',
          autoAnswerReason,
          // A root-frame contract reused later in a flow still needs the CURRENT rolling hash
          // as the cursor for the next question; the stored root hash only identifies the rule.
          contextHash: responseContextHash,
        };
      }
      return null;
    };

    let displayOnlyExact: ReturnType<typeof resolveFlatKey> = null;
    for (const counterpartTag of counterpartCandidates) {
      const flatKey = contextKeyFor(counterpartTag);
      const exact = resolveFlatKey(flatKey, 'KNOWN_CONTEXT_MATCH');
      // A Just-once record is retained for history/display but is not a chatbot rule. It must
      // not shadow an auto-reusable root default for this frame.
      if (exact?.mode === 'auto') return exact;

      const rootFlatKey = rootContextKeyFor(counterpartTag);
      if (rootFlatKey !== flatKey) {
        const rootDefault = resolveFlatKey(
          rootFlatKey,
          'KNOWN_ROOT_CONTEXT_MATCH',
          flatKey.replace(/^flat_v\d+_/, ''),
        );
        if (rootDefault?.mode === 'auto') return rootDefault;
      }

      displayOnlyExact ??= exact;
    }

    // Explicit broad contract: exact question identity + first preferred answer currently
    // offered. It deliberately ignores choice membership and rolling position, but never uses
    // fuzzy text or inferred subsets. Exact rolling/root-frame contracts above always win.
    const contracts = getQuestionDefaultContracts();
    for (const counterpartTag of counterpartCandidates) {
      const questionKey = buildQuestionDefaultKey(talk, currentQuestion, { mySelfTag, counterpartTag });
      const preferred = resolveQuestionDefault(contracts, questionKey, currentQuestion.answers || []);
      if (!preferred) continue;
      return {
        answerId: preferred.answerId,
        answerText: preferred.answerText,
        mode: 'auto',
        questionText: currentQuestion.text || '',
        allAnswers: currentQuestion.answers || [],
        autoAnswerAction: 'ANSWER',
        autoAnswerReason: 'KNOWN_QUESTION_DEFAULT',
        contextHash: contextKeyFor(counterpartTag).replace(/^flat_v\d+_/, ''),
      };
    }

    // Preserve the existing Just-once display behavior when no reusable contract matched.
    if (displayOnlyExact) return displayOnlyExact;
  }

  // Multi-select and all missing/legacy/changed contexts are intentionally user decisions.
  // Legacy records have no complete context hash and therefore cannot safely auto-answer.
  void talkInstanceId;
  return null;
}

export function saveAnswerPreference(
  currentUserId: string | undefined,
  talk: any,
  talkInstanceId: string,
  currentQuestion: { id: string; text?: string; answers?: any[]; answerSelectionMode?: string; contextPath?: Array<{ questionId: string; answerId: string }> },
  answerId: string,
  answerText: string,
  fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerId?: string; answerText?: string; contextHash?: string }>,
  mode: 'auto' | 'manual' | 'whenever' | 'permanent' | 'suppressed' = 'auto',
): string {
  const exactMemory = getExactChatbotMemory();
  const languageContext = { language: String(talk?.language || 'en').toLowerCase() };
  // The selfTag to persist alongside this answer is always MY OWN effective tag for this
  // deal, derived from the nearest Pair-tag ancestor (`myEffectiveTagContext`, §LL follow-up)
  // — this lets findAutoAnswer/getSelfTagForQuestionText later veto a preference mismatch
  // without every call site here having to know or pass that distinction explicitly. §KK:
  // also drives the flattened-store write below.
  const { mySelfTag, counterpartCandidates, isMine } = effectiveTagContext(currentUserId, talk, currentQuestion);
  // docs/TODO.md §JJ residual gap: when this answer is being taught by self-answering MY OWN
  // talk (isMine), remember which talk taught it — lets a later chatbot auto-reply that reuses
  // this exact memory trace back to the specific one of my own deal-eligible talks it
  // represents (app.ts's resolveResponderSourceTalkIdForAnswers), instead of the deal-
  // confirmation fallback that disables every one of my active listings. undefined (not
  // recorded) when this answer instead came from answering someone ELSE's talk — there is no
  // "my talk" to attribute it to.
  const sourceTalkId = isMine ? talkInstanceId : undefined;
  if (currentQuestion.text) {
    if (mode === 'suppressed') {
      saveSuppressedQuestion(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, undefined, languageContext);
    } else if (mode === 'permanent') {
      savePermanentAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag, sourceTalkId);
    } else if (mode === 'auto') {
      saveTemporaryAnswer(exactMemory, LOCAL_EXACT_CHATBOT_USER_ID, currentQuestion.text, answerText, undefined, languageContext, mySelfTag, sourceTalkId);
    }
    setExactChatbotMemory(exactMemory);
  }

  const preferences = getAnswerPreferences();
  const legacyKey = `${talkInstanceId}_${currentQuestion.id}`;
  const qIndex = Math.max(
    0,
    talk.questions?.findIndex((q: { id: string }) => q.id === currentQuestion.id) ?? 0,
  );
  // Mirrors the read-side override in `resolveAnswerPreferenceForTalkQuestion` — a
  // matchThreshold route's direct-child specs are independent, so their save key must not
  // depend on whichever sibling specs happened to be saved earlier in this loop.
  const previous = getRouteRootChildQuestionIds(talk)?.includes(currentQuestion.id)
    ? []
    : immediateParentQAPairs(talk, currentQuestion, fullSessionAnswersIncludingCurrent.slice(0, -1));

  // §KK: write the same answer under one flattened-key bucket per counterpart-tag candidate
  // `myEffectiveTagContext` returns — today that's always at most one (the nearest Pair-tag
  // ancestor's own counterpart), but the fan-out shape is kept in case a future context source
  // ever yields more than one candidate.
  const primaryFlatKey = buildAnswerPreferenceLookupKey(
    talk,
    '',
    qIndex,
    previous,
    currentQuestion.text || '',
    { mySelfTag, counterpartTag: counterpartCandidates[0] },
    currentQuestion,
  );
  const primaryContextHash = primaryFlatKey.replace(/^flat_v\d+_/, '');
  const primaryQuestionDefaultKey = buildQuestionDefaultKey(
    talk,
    currentQuestion,
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
    contextHash: primaryContextHash,
    contextVersion: ANSWER_CONTEXT_VERSION,
    questionDefaultKey: primaryQuestionDefaultKey,
    answerIdentityHash: buildAnswerIdentityHash(answerText),
    answerSelectionMode: currentQuestion.answerSelectionMode || 'single',
  };

  preferences[legacyKey] = entry;
  setAnswerPreferences(preferences);

  const flatMap = getFlattenedAnswerPreferences();
  const questionDefaults = getQuestionDefaultContracts();
  for (const counterpartTag of counterpartCandidates) {
    const flatKey = buildAnswerPreferenceLookupKey(
      talk,
      '',
      qIndex,
      previous,
      currentQuestion.text || '',
      { mySelfTag, counterpartTag },
      currentQuestion,
    );
    if (mode === 'whenever') {
      // The broad contract is a distinct scope, not another exact-context alias. If Bob changes
      // an existing exact answer to Whenever offered in this same frame, remove that conflicting
      // exact rule so the newly selected broad preference can take effect here immediately.
      delete flatMap[flatKey];
      const questionKey = buildQuestionDefaultKey(talk, currentQuestion, { mySelfTag, counterpartTag });
      putQuestionDefault(questionDefaults, {
        questionKey,
        questionText: currentQuestion.text || '',
        language: String(talk?.language || 'en'),
        selectionMode: currentQuestion.answerSelectionMode || 'single',
        tagScope: { mySelfTag, counterpartTag },
        answerText,
        updatedAt: entry.timestamp,
      });
    } else {
      flatMap[flatKey] = {
        ...entry,
        flatKey,
        contextHash: flatKey.replace(/^flat_v\d+_/, ''),
      };
    }
  }
  setFlattenedAnswerPreferences(flatMap);
  setQuestionDefaultContracts(questionDefaults);
  console.log('💾 Saved answer (known context + legacy metadata):', primaryFlatKey, answerText, mode);
  return primaryContextHash;
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
    // docs/TODO.md §LL follow-up: mirrors `immediateParentQAPairs`'s own exclusion — a
    // Pair-tag question's (text, answer) differs by construction between independently-
    // authored talks, so it's kept out of the path every later question's flattened lookup
    // key is built from (see that function's doc comment for the full reasoning).
    const nextPairs = q.reciprocalTagContext
      ? branchPairs
      : [
          ...branchPairs,
          {
            questionText: (q.text || '').trim(),
            answerText: (pref.answerText || '').trim(),
            ...(pref.contextHash ? { contextHash: pref.contextHash } : {}),
          },
        ];

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
