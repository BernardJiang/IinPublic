import { Talk, Question, Answer, ContextStep, AnswerWithContext } from './types';
import { TalkStructureError, ValidationError } from './errors';

/** Answer record as submitted by the user (e.g. from talk response flow) */
export interface SubmittedAnswer {
  questionId: string;
  answerId: string;
  answerText?: string;
  isChecked?: boolean;
  /**
   * Spec §3.4 FR-QA-15/16: the full selected set for an `answerSelectionMode: 'multiple'`
   * question — the authoritative set when present (see `selectedAnswerIds` in this file).
   * `answerId` alone stays required for backward compatibility (single-select and every
   * pre-existing call site); when both are present `answerId` SHOULD be `answerIds[0]`.
   */
  answerIds?: string[];
}

export type WeightedTagInput =
  | Record<string, number>
  | Map<string, number>
  | Array<string | { id?: string; name?: string; weight?: number; popularity?: number }>
  | null
  | undefined;

export type MatchScoreCombine = (viewerWeight: number, otherWeight: number, tag: string) => number;

function normalizeTagKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function toWeightMap(input: WeightedTagInput): Map<string, number> {
  const map = new Map<string, number>();
  if (!input) return map;

  const setWeight = (rawKey: unknown, rawWeight: unknown) => {
    const key = normalizeTagKey(rawKey);
    if (!key) return;
    const parsed = Number(rawWeight);
    map.set(key, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
  };

  if (input instanceof Map) {
    for (const [k, v] of input.entries()) setWeight(k, v);
    return map;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      if (typeof entry === 'string') {
        setWeight(entry, 1);
        continue;
      }
      setWeight(entry?.name || entry?.id, (entry as any)?.weight ?? (entry as any)?.popularity ?? 1);
    }
    return map;
  }

  for (const [k, v] of Object.entries(input)) {
    setWeight(k, v);
  }
  return map;
}

/**
 * Shared weighted score for find-similar ranking.
 *
 * Inputs can be a tag-weight map, array of tags, or array of tag names.
 * Score is the sum of `combine(viewerWeight, otherWeight, tag)` over all shared tags.
 *
 * Use `combine = () => 1` for unweighted overlap count.
 */
export function matchScore(
  viewer: WeightedTagInput,
  other: WeightedTagInput,
  combine: MatchScoreCombine = (viewerWeight, otherWeight) => Math.min(viewerWeight, otherWeight),
): number {
  const viewerMap = toWeightMap(viewer);
  const otherMap = toWeightMap(other);
  let score = 0;
  for (const [tag, viewerWeight] of viewerMap.entries()) {
    const otherWeight = otherMap.get(tag);
    if (otherWeight === undefined) continue;
    const delta = Number(combine(viewerWeight, otherWeight, tag));
    if (Number.isFinite(delta)) score += delta;
  }
  return score;
}

/**
 * Determines if the last submitted answer is a match (flow/tag/route talks).
 * Used by both frontend and backend so match logic lives in one place.
 *
 * Route talks resolve identically to flow: the receiver's answers[] is the full
 * root-to-terminal path in order, and each route question's id is unique across
 * the whole talk (TalkValidator.validateRouteTalk enforces uniqueness on the
 * (id, contextPath) pair, but in practice every node gets its own id — the same
 * simple `questions.find(q => q.id === X)` lookup the response UI itself uses to
 * navigate the DAG, see talk-response-dialog.ts), so no contextPath/contextHash
 * reconstruction is needed here — just checking the terminal answer's own
 * isMatch flag is sufficient.
 */
/**
 * Spec §3.4 FR-QA-16 / §30.8: every stored answer, single- or multi-select, is treated as a
 * set of answer IDs — a 'single'-mode answer is the degenerate case, a set of size one.
 * `SubmittedAnswer.answerIds` (when present) is the authoritative multi-select set;
 * `answerId` alone (today's shape) is a singleton set. Never empty for a real submitted
 * answer, since `answerId` is always required.
 */
function selectedAnswerIds(submitted: SubmittedAnswer): string[] {
  return submitted.answerIds && submitted.answerIds.length > 0 ? submitted.answerIds : [submitted.answerId];
}

/**
 * The set-intersection match predicate (FR-QA-16): true iff at least one of the
 * respondent's selected answer IDs corresponds to an option this question flags
 * `isMatch`. For a singleton set this reduces to exactly today's single-answer check —
 * a strict generalization, not a behavior change, for every existing 'single'-mode
 * question (proof: {x} intersects the isMatch-flagged set iff x itself is isMatch-flagged).
 */
function anySelectedIsMatch(question: any, selectedIds: string[]): boolean {
  return selectedIds.some((id) => question.answers?.find((a: any) => a.id === id)?.isMatch === true);
}

/** Mirrors `anySelectedIsMatch`: at least one selected id is isIgnore-flagged. Computed
 *  independently of `anySelectedIsMatch`, same as the original single-answer functions never
 *  cross-checked each other — for a singleton set this reduces to exactly today's behavior. */
function anySelectedIsIgnore(question: any, selectedIds: string[]): boolean {
  return selectedIds.some((id) => question.answers?.find((a: any) => a.id === id)?.isIgnore === true);
}

/**
 * Route talks with `Talk.matchThreshold` set treat every direct child of the root as an
 * independent spec — order-independent by construction. The root is the question with an empty
 * `contextPath` (route questions always carry one; empty means "no prior context," i.e. root —
 * see `Question.contextPath`'s doc comment). Its direct children are whatever its own
 * answers/`branchingLogic` point to via `nextQuestionId`, in the order the author declared them.
 * Returns `null` when the talk isn't in matchThreshold mode at all, or has no recognizable
 * root/children (malformed data) — callers treat this as "not applicable," never throwing.
 *
 * Shared between `computeRouteMatchScore` (scoring, this file) and the response dialog's
 * multi-branch walk (`talk-response-dialog.ts`, spec's-own navigation) so both agree on exactly
 * which questions count as "the specs to walk/score" from the same source of truth.
 */
export function getRouteRootChildQuestionIds(talkData: Talk | any): string[] | null {
  if (talkData?.type !== 'route' || talkData?.matchThreshold == null) return null;
  const questions = Array.isArray(talkData.questions) ? talkData.questions : [];
  const root = questions.find((q: any) => Array.isArray(q.contextPath) && q.contextPath.length === 0);
  if (!root) return null;

  const childIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: unknown) => {
    const value = String(id ?? '');
    if (!value || seen.has(value)) return;
    seen.add(value);
    childIds.push(value);
  };
  for (const a of root.answers || []) add(a?.nextQuestionId);
  for (const b of root.branchingLogic || []) add(b?.nextQuestionId);
  return childIds.length > 0 ? childIds : null;
}

/**
 * Each direct-child spec is assumed exactly one question deep (spec -> terminal) — nested
 * branching under a matchThreshold route is out of scope; only `answers[]` entries for a
 * recognized direct-child question id count toward the score, so any deeper/unexpected entries
 * are silently ignored rather than corrupting the total. See `getRouteRootChildQuestionIds` for
 * how the spec set itself is determined. Returns `null` when the talk isn't in matchThreshold
 * mode — the caller falls back to the existing terminal-only rule unchanged.
 */
export function computeRouteMatchScore(
  talkData: Talk | any,
  answers: SubmittedAnswer[],
): { score: number; total: number } | null {
  const childIds = getRouteRootChildQuestionIds(talkData);
  if (!childIds) return null;
  const childIdSet = new Set(childIds);
  const questions = Array.isArray(talkData.questions) ? talkData.questions : [];

  let score = 0;
  for (const submitted of answers) {
    if (!childIdSet.has(submitted.questionId)) continue;
    const question = questions.find((q: any) => q.id === submitted.questionId);
    if (!question) continue;
    if (anySelectedIsMatch(question, selectedAnswerIds(submitted))) score += 1;
  }
  return { score, total: childIds.length };
}

export function checkIfMatch(talkData: Talk | any, answers: SubmittedAnswer[], responderSelfTag?: string): boolean {
  if (talkData.type !== 'flow' && talkData.type !== 'tag' && talkData.type !== 'route') {
    return false;
  }
  // Preference-set veto (spec §30.2): a talk that declares a non-empty preferenceSet (e.g.
  // "buy" accepted by "sell") must never match a responder whose own selfTag isn't a member
  // of it — only a responder with no selfTag at all, or one within the set, is legitimate.
  // This runs before the isMatch check so it overrides whatever answer was picked, whether by
  // a human or the chatbot's exact-text auto-reply (src/shared/exact-chatbot-memory.ts).
  if (talkData.preferenceSet?.length && responderSelfTag && !talkData.preferenceSet.includes(responderSelfTag)) {
    return false;
  }
  const routeScore = computeRouteMatchScore(talkData, answers);
  if (routeScore) return routeScore.score >= talkData.matchThreshold;

  const lastAnswer = answers[answers.length - 1];
  if (!lastAnswer) return false;
  const question = talkData.questions?.find((q: any) => q.id === lastAnswer.questionId);
  if (!question) return false;
  return anySelectedIsMatch(question, selectedAnswerIds(lastAnswer));
}

export function checkIfIgnore(talkData: Talk | any, answers: SubmittedAnswer[]): boolean {
  if (talkData.type !== 'flow' && talkData.type !== 'tag' && talkData.type !== 'route') {
    return false;
  }
  const lastAnswer = answers[answers.length - 1];
  if (!lastAnswer) return false;
  const question = talkData.questions?.find((q: any) => q.id === lastAnswer.questionId);
  if (!question) return false;
  return anySelectedIsIgnore(question, selectedAnswerIds(lastAnswer));
}

export class TalkValidator {
  /**
   * Validates that a talk structure forms a DAG (no loops)
   */
  static validateDAGStructure(talk: Talk): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    
    for (const question of talk.questions) {
      if (!visited.has(question.id)) {
        if (this.hasCycleDFS(question, talk.questions, visited, recursionStack)) {
          throw new TalkStructureError(
            `Talk contains a loop starting from question: ${question.id}`,
            talk.id
          );
        }
      }
    }
  }
  
  private static hasCycleDFS(
    current: Question,
    allQuestions: Question[],
    visited: Set<string>,
    recursionStack: Set<string>
  ): boolean {
    visited.add(current.id);
    recursionStack.add(current.id);
    
    const nextQuestionIds = this.getNextQuestionIds(current);
    
    for (const nextId of nextQuestionIds) {
      const nextQuestion = allQuestions.find(q => q.id === nextId);
      if (!nextQuestion) continue;
      
      if (!visited.has(nextId)) {
        if (this.hasCycleDFS(nextQuestion, allQuestions, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(nextId)) {
        return true; // Back edge found - cycle detected
      }
    }
    
    recursionStack.delete(current.id);
    return false;
  }
  
  private static getNextQuestionIds(question: Question): string[] {
    const nextIds: string[] = [];
    
    // Linear flow
    if (question.nextQuestionId) {
      nextIds.push(question.nextQuestionId);
    }
    
    // Branching logic
    if (question.branchingLogic) {
      for (const branch of question.branchingLogic) {
        nextIds.push(branch.nextQuestionId);
      }
    }
    
    // Answer-specific next questions
    for (const answer of question.answers) {
      if (answer.nextQuestionId) {
        nextIds.push(answer.nextQuestionId);
      }
    }
    
    return nextIds;
  }
  
  /**
   * Validates talk structure and content.
   *
   * Dispatch table for the four talk types (§3.6.1):
   *   tag      → validateTagTalk
   *   flow     → validateFlowTalk   (linear sequential Q/A; first answer must be match-or-next)
   *   survey   → validateSurveyTalk (independent Q/A; per-answer counters)
   *   route    → validateRouteTalk  (hierarchical DAG with context paths)
   */
  static validateTalk(talk: Talk): void {
    if (!talk.title?.trim()) {
      throw new ValidationError('Talk title is required');
    }

    if (talk.questions.length === 0) {
      throw new ValidationError('Talk must have at least one question');
    }

    const isTagByType = String(talk.type) === 'tag';
    const isTagByStructure =
      talk.questions.length === 1 &&
      talk.questions[0].answers?.length === 2 &&
      talk.questions[0].answers.some((a) => a.isMatch) &&
      talk.questions[0].answers.some((a) => a.isIgnore);
    if (isTagByType || isTagByStructure) {
      this.validateTagTalk(talk);
      return;
    }

    if (talk.type === 'route') {
      this.validateRouteTalk(talk);
      return;
    }

    if (talk.type === 'survey') {
      this.validateSurveyTalk(talk);
      return;
    }

    // Default: flow
    this.validateFlowTalk(talk);
  }

  /**
   * Flow talks form a linear chain of unique questions. The first answer on
   * every question decides where to go next (match / goto); every other answer
   * is implicitly "ignore" (filter out). From the second question onward each
   * question carries a contextHashId chained from the previous (qid,aid) pairs.
   */
  private static validateFlowTalk(talk: Talk): void {
    if (talk.questions.length > 20) {
      throw new ValidationError('Talk cannot have more than 20 questions');
    }

    // Question-level rules (text, answer count, per-answer text validity).
    for (const question of talk.questions) {
      this.validateQuestion(question);
    }

    // All questions must be textually unique.
    const seenTexts = new Set<string>();
    const seenIds = new Set<string>();
    for (const q of talk.questions) {
      const norm = q.text.trim().toLowerCase();
      if (seenTexts.has(norm)) {
        throw new ValidationError(`Flow has duplicate question: "${q.text}"`);
      }
      seenTexts.add(norm);
      if (seenIds.has(q.id)) {
        throw new ValidationError(`Flow has duplicate question id: ${q.id}`);
      }
      seenIds.add(q.id);
    }

    // First answer on every question must be a "match" or a "go to next
    // question" link; it may not be an ignore. Every remaining answer is
    // treated as ignore (and must not carry match/next semantics).
    //
    // Spec §3.4 FR-QA-15/16, §30.8: a `'multiple'`-mode ("pick any that apply") question is
    // exempt from the "only the first answer decides" rule entirely — it intentionally allows
    // more than one answer to be isMatch-flagged at once (TalkAutofix.fix applies the matching
    // exemption before validation ever sees this). It's still checked for the invariants that
    // DO still apply: at least one isMatch or one isIgnore answer, and no answer carries a
    // nextQuestionId (a multi-select question is always chain-terminal).
    for (const q of talk.questions) {
      const first = q.answers[0];
      if (!first) {
        throw new ValidationError(`Flow question has no answers: ${q.id}`);
      }
      if (q.answerSelectionMode === 'multiple') {
        for (const a of q.answers) {
          if (a.nextQuestionId) {
            throw new ValidationError(
              `Flow question "${q.id}": a "pick any that apply" question cannot link to another question ("${a.id}").`,
            );
          }
        }
        continue;
      }
      if (first.isIgnore) {
        throw new ValidationError(
          `Flow question "${q.id}": the first answer must be a match or a "go to next question" link, not ignore.`,
        );
      }
      const firstIsMatch = first.isMatch === true;
      const firstIsNext = typeof first.nextQuestionId === 'string' && first.nextQuestionId.length > 0;
      if (!firstIsMatch && !firstIsNext) {
        throw new ValidationError(
          `Flow question "${q.id}": the first answer must either be a match or link to the next question.`,
        );
      }
      // Every non-first answer is implicitly "ignore"; any conflicting flag is
      // an error so the UI and data stay in sync.
      for (let i = 1; i < q.answers.length; i++) {
        const a = q.answers[i];
        if (a.isMatch || a.nextQuestionId) {
          throw new ValidationError(
            `Flow question "${q.id}": only the first answer may be a match or link; answer "${a.id}" must be ignore.`,
          );
        }
      }
    }

    // Validate DAG structure (no cycles).
    this.validateDAGStructure(talk);

    // Validate the chained contextHashId for every question from the 2nd on.
    // Q1's context is empty (''). Qn's context is the chain q1:a1|...|q(n-1):a(n-1),
    // where a_k is the "match / next" first answer of Q_k.
    let chain: ContextStep[] = [];
    for (let i = 0; i < talk.questions.length; i++) {
      const q = talk.questions[i];
      const expected = RouteProcessor.buildContextHash(chain);
      if (q.contextHashId !== undefined && q.contextHashId !== expected) {
        throw new ValidationError(
          `Flow question "${q.id}" has contextHashId="${q.contextHashId}" but expected "${expected}".`,
        );
      }
      chain = [...chain, { questionId: q.id, answerId: q.answers[0].id }];
    }
  }
  
  /**
   * Tag: simplest form of talk. Single question (keyword/short phrase), one checkbox:
   * checked = match, unchecked = ignore.
   */
  private static validateTagTalk(talk: Talk): void {
    if (talk.questions.length !== 1) {
      throw new ValidationError('Tag must have exactly one question');
    }
    const q = talk.questions[0];
    if (!q.text || !q.text.trim()) {
      throw new ValidationError('Tag question (keyword) is required');
    }
    if (q.answers.length !== 2) {
      throw new ValidationError('Tag must have exactly two answers (match and ignore)');
    }
    const hasMatch = q.answers.some(a => a.isMatch);
    const hasIgnore = q.answers.some(a => a.isIgnore);
    if (!hasMatch || !hasIgnore) {
      throw new ValidationError('Tag must have one match and one ignore answer');
    }
  }
  
  private static validateQuestion(question: Question): void {
    if (!question.text?.trim()) {
      throw new ValidationError(`Question text is required for question ${question.id}`);
    }

    // Trailing '?' is a stylistic convention, not a semantic rule — the
    // validator used to require it, but that rejected reasonable answers
    // like "Do you play tennis" or the same question with a period/ellipsis.
    // The UI displays whatever the user typed.

    if (question.answers.length === 0) {
      throw new ValidationError(`Question must have at least one answer: ${question.id}`);
    }

    if (question.answers.length > 10) {
      throw new ValidationError(`Question cannot have more than 10 answers: ${question.id}`);
    }

    // Ensure "Ignore" option is always available
    const hasIgnore = question.answers.some(a => a.isIgnore);
    if (!hasIgnore) {
      throw new ValidationError(`Question must have an "Ignore" option: ${question.id}`);
    }

    // Validate each answer
    for (const answer of question.answers) {
      this.validateAnswer(answer, question.id);
    }
  }

  private static validateAnswer(answer: Answer, questionId: string): void {
    if (!answer.text?.trim()) {
      throw new ValidationError(`Answer text is required for answer ${answer.id} in question ${questionId}`);
    }

    // Trailing '.' was previously required; dropped so short answers like
    // "Yes", "No", or "amateur" pass validation. The UI preserves the raw
    // text so DOM attributes (data-answer-text) match what the user sees.
  }
  
  /**
   * Survey talks are a collection of independent questions (star graph). No
   * question has a `nextQuestionId` or branching, and every question's
   * contextHashId is '' because no prior Q/A affects any other. Every answer
   * carries a numeric counter (initialised to 0) so aggregate statistics can
   * be kept server-side.
   */
  private static validateSurveyTalk(talk: Talk): void {
    const aggregatableQuestions = talk.questions.filter(q => q.isAggregatable);

    if (aggregatableQuestions.length === 0) {
      throw new ValidationError('Survey talk must have at least one aggregatable question');
    }

    if (talk.questions.length > 15) {
      throw new ValidationError('Survey talk cannot have more than 15 questions');
    }

    // Per-question rules (text ends with '?', answers end with '.', etc).
    for (const question of talk.questions) {
      this.validateQuestion(question);

      if (question.nextQuestionId) {
        throw new ValidationError(
          `Survey questions are independent and cannot link to other questions (got nextQuestionId on ${question.id}).`,
        );
      }
      if (question.branchingLogic && question.branchingLogic.length > 0) {
        throw new ValidationError(
          `Survey questions cannot have branching logic (got branchingLogic on ${question.id}).`,
        );
      }
      if (question.contextHashId !== undefined && question.contextHashId !== '') {
        throw new ValidationError(
          `Survey question "${question.id}" must have contextHashId="" (got "${question.contextHashId}").`,
        );
      }

      for (const a of question.answers) {
        if (a.nextQuestionId) {
          throw new ValidationError(
            `Survey answer "${a.id}" on question "${question.id}" cannot have nextQuestionId.`,
          );
        }
        if (a.counter !== undefined && (typeof a.counter !== 'number' || a.counter < 0 || !Number.isFinite(a.counter))) {
          throw new ValidationError(
            `Survey answer "${a.id}" on question "${question.id}" has invalid counter value.`,
          );
        }
      }
    }
  }

  /**
   * Validates a route talk (type === 'route').
   *
   * Rules:
   * - Must have at least one question.
   * - Must not exceed 50 questions (route talks can be large).
   * - Every question must have valid text and at least one answer.
   * - Every question must have a `contextPath` (root questions use []).
   * - No two questions may share the same (id, contextHash) pair.
   * - The graph must be a DAG (no cycles).
   * - contextPath entries must refer to questions and answers that actually
   *   exist in the talk.
   */
  private static validateRouteTalk(talk: Talk): void {
    if (talk.questions.length > 50) {
      throw new ValidationError('Route cannot have more than 50 questions');
    }

    const questionIds = new Set(talk.questions.map(q => q.id));
    const seenContextKeys = new Set<string>();

    for (const question of talk.questions) {
      if (!question.text?.trim()) {
        throw new ValidationError(`Question text is required for question ${question.id}`);
      }

      if (question.answers.length === 0) {
        throw new ValidationError(`Question must have at least one answer: ${question.id}`);
      }

      // contextPath is mandatory on route questions ([] for root questions)
      if (question.contextPath === undefined) {
        throw new ValidationError(
          `Route question must have a contextPath (use [] for root questions): ${question.id}`
        );
      }

      // Validate that each context step refers to real questions/answers
      for (const step of question.contextPath) {
        if (!questionIds.has(step.questionId)) {
          throw new ValidationError(
            `contextPath references unknown questionId "${step.questionId}" in question ${question.id}`
          );
        }
        const contextQuestion = talk.questions.find(q => q.id === step.questionId);
        const answerExists = contextQuestion?.answers.some(a => a.id === step.answerId);
        if (!answerExists) {
          throw new ValidationError(
            `contextPath references unknown answerId "${step.answerId}" for question "${step.questionId}" in question ${question.id}`
          );
        }
      }

      // Uniqueness check: (questionId + contextHash) must be unique across all nodes
      const contextHash = RouteProcessor.buildContextHash(question.contextPath);
      const uniqueKey = `${question.id}::${contextHash}`;
      if (seenContextKeys.has(uniqueKey)) {
        throw new ValidationError(
          `Duplicate (questionId, contextPath) combination for question ${question.id}`
        );
      }
      seenContextKeys.add(uniqueKey);

      // Denormalized contextHashId must match the contextPath if present.
      if (question.contextHashId !== undefined && question.contextHashId !== contextHash) {
        throw new ValidationError(
          `Route question "${question.id}" contextHashId="${question.contextHashId}" does not match contextPath hash "${contextHash}".`
        );
      }

      // Per-path uniqueness: the same question text must not appear twice on
      // a single root→leaf path. Because the contextPath IS the path, we just
      // check that none of the ancestors shares this question's (normalized) text.
      const selfText = question.text.trim().toLowerCase();
      for (const step of question.contextPath) {
        const ancestor = talk.questions.find(q => q.id === step.questionId);
        if (ancestor && ancestor.text.trim().toLowerCase() === selfText) {
          throw new ValidationError(
            `Route has repeating question on path: "${question.text}" appears twice between the root and node ${question.id}.`
          );
        }
      }
    }

    // DAG check — no cycles
    this.validateDAGStructure(talk);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TalkAutofix — best-effort repair for common user mistakes before save.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returned by {@link TalkAutofix.fix} so the UI can tell the user what was
 * changed on their behalf.
 */
export interface TalkAutofixReport {
  /** The fixed talk (new object — the input is not mutated). */
  talk: Talk;
  /** Human-readable descriptions of every patch applied. */
  fixes: string[];
}

/**
 * Small heuristics that repair common mistakes the user is likely to make in
 * the create-talk form. Call this BEFORE {@link TalkValidator.validateTalk} so
 * validation only fails on things we can't silently fix.
 *
 * Behaviour by type:
 *   tag    – nothing to fix (dialog owns structure entirely).
 *   flow   – auto-renames duplicate question texts, ensures Q1's first answer
 *            has match/next semantics, strips match/next from later answers,
 *            recomputes chained contextHashIds.
 *   survey – clears nextQuestionId / branchingLogic, zeroes counter on every
 *            answer, sets contextHashId = '', marks at least one question
 *            aggregatable when none is.
 *   route  – fills in contextPath=[] on root questions, recomputes
 *            contextHashId from contextPath.
 */
export class TalkAutofix {
  static fix(input: Talk): TalkAutofixReport {
    const fixes: string[] = [];
    // Deep-clone so callers can diff or roll back.
    const talk: Talk = JSON.parse(JSON.stringify(input));

    // Trim whitespace on all question/answer text fields. Leaving other
    // punctuation (periods, question marks, exclamation points) as the user
    // typed them so the DOM `data-answer-text` attribute — and any test or
    // screen-reader output that keys off it — matches the raw input.
    for (const q of talk.questions ?? []) {
      if (typeof q.text === 'string' && q.text !== q.text.trim()) {
        q.text = q.text.trim();
      }
      for (const a of q.answers ?? []) {
        if (typeof a.text === 'string' && a.text !== a.text.trim()) {
          a.text = a.text.trim();
        }
      }
    }

    if (talk.type === 'tag') {
      return { talk, fixes };
    }

    if (talk.type === 'survey') {
      let hasAggregatable = false;
      for (const q of talk.questions) {
        if (q.nextQuestionId) {
          delete q.nextQuestionId;
          fixes.push(`Removed nextQuestionId from survey question "${q.id}".`);
        }
        if (q.branchingLogic && q.branchingLogic.length > 0) {
          q.branchingLogic = [];
          fixes.push(`Cleared branchingLogic on survey question "${q.id}".`);
        }
        if (q.contextHashId !== '') {
          q.contextHashId = '';
        }
        if (q.isAggregatable) hasAggregatable = true;
        for (const a of q.answers) {
          if (a.nextQuestionId) {
            delete a.nextQuestionId;
            fixes.push(`Removed nextQuestionId from survey answer "${a.id}".`);
          }
          if (typeof a.counter !== 'number' || !Number.isFinite(a.counter) || a.counter < 0) {
            a.counter = 0;
          }
        }
      }
      if (!hasAggregatable && talk.questions.length > 0) {
        talk.questions[0].isAggregatable = true;
        fixes.push('Marked first survey question as aggregatable.');
      }
      return { talk, fixes };
    }

    if (talk.type === 'route') {
      for (const q of talk.questions) {
        if (q.contextPath === undefined) {
          q.contextPath = [];
          fixes.push(`Filled in empty contextPath for route question "${q.id}".`);
        }
        // §BB / spec §30.2, docs/TODO.md §BB Phase 6: same synthetic-answer generation as the
        // flow branch below — a builtIn route question has no author-typed answers, and unlike
        // flow, TalkAutofix never needs to redirect its "compatible" answer to a next question:
        // the route editor has no way to attach a child to a builtIn node (see
        // ui-manager.ts's routeEditorQuestions doc comment), so it is always a leaf.
        if (q.builtIn && q.answers.length === 0) {
          q.answers = [
            { id: `${q.id}_compatible`, text: 'Compatible', isMatch: true, isTerminal: true },
            { id: `${q.id}_incompatible`, text: 'Not compatible', isIgnore: true, isTerminal: true },
          ];
          fixes.push(`Generated synthetic answers for built-in question "${q.id}" (${q.builtIn.kind}).`);
        }
        const expected = RouteProcessor.buildContextHash(q.contextPath);
        if (q.contextHashId !== expected) {
          q.contextHashId = expected;
        }
      }
      return { talk, fixes };
    }

    // Default: flow
    // 1) De-duplicate question texts by appending " (2)", " (3)", …
    const textCounts = new Map<string, number>();
    for (const q of talk.questions) {
      const norm = q.text.trim().toLowerCase();
      const count = (textCounts.get(norm) ?? 0) + 1;
      textCounts.set(norm, count);
      if (count > 1) {
        // append disambiguator before the trailing '?'
        const base = q.text.trim().replace(/\?+\s*$/, '');
        q.text = `${base} (${count})?`;
        fixes.push(`Renamed duplicate flow question "${q.id}" to "${q.text}".`);
      }
    }

    // 1.5) Auto-generate the 2 synthetic answers for built-in typed questions (§BB, spec
    // §30.2). A builtIn question's outcome is computed from typed values (interval-overlap /
    // quantity sufficiency / location containment, wired in a later phase) rather than
    // chosen by a human or looked up by exact text — the author never types answers for it.
    // Feeding these synthetic answers into step 2 below (unchanged) is what turns the
    // "compatible" answer into a terminal match or a link to the next question exactly like
    // any other flow question.
    for (const q of talk.questions) {
      if (!q.builtIn || q.answers.length > 0) continue;
      q.answers = [
        { id: `${q.id}_compatible`, text: 'Compatible', isMatch: true, isTerminal: true },
        { id: `${q.id}_incompatible`, text: 'Not compatible', isIgnore: true, isTerminal: true },
      ];
      fixes.push(`Generated synthetic answers for built-in question "${q.id}" (${q.builtIn.kind}).`);
    }

    // 2) Ensure the first answer of every question is a match or "go to next".
    for (let i = 0; i < talk.questions.length; i++) {
      const q = talk.questions[i];
      if (q.answers.length === 0) continue;

      if (q.answerSelectionMode === 'multiple') {
        // Spec §3.4 FR-QA-15/16, §30.8: a "pick any that apply" question intentionally
        // allows MORE THAN ONE answer to be isMatch-flagged at once — skip the single-answer
        // collapsing below entirely (steps 2/3 assume exactly one meaningful answer, which
        // would silently strip isMatch from every option but the first). Every answer keeps
        // whatever isMatch/isIgnore the editor set (the answer-next dropdown), normalized to
        // terminal — a multi-select question is always chain-terminal, enforced by the
        // editor's own dropdown restriction (talk-editor-form-helpers.ts) to Ignore/Noticed
        // only, no "go to next question".
        for (const a of q.answers) {
          delete a.nextQuestionId;
          a.isTerminal = true;
          if (a.isMatch === true) {
            delete a.isIgnore;
          } else {
            a.isIgnore = true;
            delete a.isMatch;
          }
        }
        continue;
      }

      const first = q.answers[0];
      const nextId = talk.questions[i + 1]?.id;
      const firstIsMatch = first.isMatch === true;
      const firstIsNext = typeof first.nextQuestionId === 'string' && first.nextQuestionId.length > 0;
      // Redirect when: ignore, no flags at all, OR match set on a non-last question
      // (user picked "noticed" on Q1 but there's still a Q2 — must go to Q2 first).
      if (first.isIgnore || (!firstIsMatch && !firstIsNext) || (firstIsMatch && !!nextId)) {
        delete first.isIgnore;
        if (nextId) {
          first.nextQuestionId = nextId;
          delete first.isMatch;
          delete first.isTerminal;
          fixes.push(`Set first answer of "${q.id}" to link to "${nextId}".`);
        } else {
          first.isMatch = true;
          first.isTerminal = true;
          delete first.nextQuestionId;
          fixes.push(`Set first answer of "${q.id}" to "match" (terminal).`);
        }
      }

      // 3) Every non-first answer is implicitly ignore: strip conflicting flags.
      for (let j = 1; j < q.answers.length; j++) {
        const a = q.answers[j];
        if (a.isMatch || a.nextQuestionId) {
          delete a.isMatch;
          delete a.nextQuestionId;
          a.isIgnore = true;
          a.isTerminal = true;
          fixes.push(`Converted non-first answer "${a.id}" on "${q.id}" to ignore.`);
        } else if (!a.isIgnore) {
          a.isIgnore = true;
          a.isTerminal = true;
        }
      }
    }

    // 4) Recompute chained contextHashId for flow.
    let chain: ContextStep[] = [];
    for (const q of talk.questions) {
      q.contextHashId = RouteProcessor.buildContextHash(chain);
      chain = [...chain, { questionId: q.id, answerId: q.answers[0]?.id ?? '' }];
    }

    return { talk, fixes };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RouteProcessor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utility class for working with route-type talks.
 *
 * Context representation:
 * Instead of storing the full list of { questionId, answerId } steps alongside
 * every stored answer, each answer carries only a single contextHash — an
 * 8-character hex string produced by FNV-1a 32-bit hashing of the canonical
 * path string.  Root / no-context questions use contextHash = '' (empty string).
 *
 * Chatbot lookup is therefore a simple string-equality check (O(1) per
 * candidate) rather than a list comparison.  The full contextPath is retained
 * only on the talk definition (Question.contextPath) where it is needed for
 * tree construction and validation.
 */
export class RouteProcessor {
  /**
   * Computes the FNV-1a 32-bit hash of a context path and returns it as an
   * 8-character lowercase hex string.
   *
   * Empty / no-context path → '' (empty string, not a hash value).
   * Non-empty path          → 8-char hex, e.g. 'a3b4c5d6'.
   *
   * The canonical input string is "qId1:aId1|qId2:aId2|..." so the hash is
   * fully determined by the ordered sequence of (questionId, answerId) pairs.
   */
  static buildContextHash(contextPath: ContextStep[]): string {
    if (!contextPath || contextPath.length === 0) return '';

    // Build canonical string: "q1:a1|q2:a2|..."
    const canonical = contextPath.map(s => `${s.questionId}:${s.answerId}`).join('|');

    // FNV-1a 32-bit — pure JS, works in both Node.js and browsers
    let hash = 0x811c9dc5;
    for (let i = 0; i < canonical.length; i++) {
      hash ^= canonical.charCodeAt(i);
      // Unsigned 32-bit multiply by FNV prime 0x01000193
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  /**
   * Given the list of submitted answers so far (in order), builds the
   * ContextStep array used to compute the context hash for the *next* question.
   *
   * For a linear talk every submitted answer contributes. For a tree the
   * caller passes only the answers in the current branch.
   */
  static buildContextPathFromSubmitted(submitted: { questionId: string; answerId: string }[]): ContextStep[] {
    return submitted.map(s => ({ questionId: s.questionId, answerId: s.answerId }));
  }

  /**
   * Converts a sequence of branched answer entries into a flat list of
   * AnswerWithContext records suitable for storage in the answer table.
   *
   * Each entry carries the contextPath that was active *at the moment the
   * question was presented*. The stored record contains only the contextHash —
   * the full path is not persisted.
   *
   * Tennis / badminton example (§3.6.1):
   *   input:
   *     { questionId: 'q_tennis',       answerId: 'a_yes',     contextPath: [] }
   *     { questionId: 'q_level_tennis', answerId: 'a_beginner',contextPath: [{q_tennis, a_yes}] }
   *   output:
   *     { questionId: 'q_tennis',       ..., contextHash: '' }
   *     { questionId: 'q_level_tennis', ..., contextHash: hash([{q_tennis,a_yes}]) }
   *
   * The second record's contextHash is distinct from the one produced by the
   * badminton branch, so the two "skill level" answers are stored independently.
   *
   * @param branchedAnswers  Each entry supplies the contextPath active when
   *                         the question was shown.
   * @param visibility       'auto' | 'manual'
   */
  static flattenTreeAnswers(
    branchedAnswers: Array<{
      questionId: string;
      answerId: string;
      answerText: string;
      contextPath: ContextStep[];
    }>,
    visibility: 'auto' | 'manual' = 'auto'
  ): AnswerWithContext[] {
    return branchedAnswers.map(entry => ({
      questionId: entry.questionId,
      answerId: entry.answerId,
      answerText: entry.answerText,
      contextHash: this.buildContextHash(entry.contextPath),
      visibility,
      recordedAt: new Date(),
    }));
  }

  /**
   * Determines whether the chatbot can auto-reply to a question.
   *
   * The chatbot computes the hash of the current conversation path and looks
   * for a stored answer whose (questionId, contextHash) pair matches. This is
   * an O(1) hash comparison — no list traversal required.
   *
   * - tag / survey / flow: pass [] for currentContext → hash is '' → matches
   *   any answer record with contextHash = '' (no-context answers).
   * - tree: pass the active ContextStep array → hash is computed → only the
   *   answer recorded under the exact same branch will match (FR-TK-12).
   *
   * @param questionId      The question the chatbot wants to answer.
   * @param currentContext  The context path active right now ([] for no-context).
   * @param storedAnswers   The user's auto-visibility AnswerWithContext records.
   * @returns               The matched record, or null if auto-reply is not possible.
   */
  static resolveContextualAnswer(
    questionId: string,
    currentContext: ContextStep[],
    storedAnswers: AnswerWithContext[]
  ): AnswerWithContext | null {
    const targetHash = this.buildContextHash(currentContext);
    const match = storedAnswers.find(
      a =>
        a.questionId === questionId &&
        a.contextHash === targetHash &&
        a.visibility === 'auto'
    );
    return match ?? null;
  }

  /**
   * Returns true if a question is a "survey-style" node in a route talk —
   * i.e. its contextPath is empty (root-level) and it is answered without
   * any required prior context.
   */
  static isSurveyStyleNode(question: Question): boolean {
    return !question.contextPath || question.contextPath.length === 0;
  }
}

export class FlowCapture {
  /**
   * Parses a chat line to extract question and answers
   * Format: "Question? Answer1; Answer2; ...; AnswerN."
   */
  static parseChatLine(line: string): { question: string; answers: string[] } | null {
    const trimmed = line.trim();
    
    // Must contain a question mark
    const questionIndex = trimmed.indexOf('?');
    if (questionIndex === -1) return null;
    
    const question = trimmed.substring(0, questionIndex + 1);
    const answersPart = trimmed.substring(questionIndex + 1).trim();
    
    // Split by semicolon and clean up
    const answers = answersPart
      .split(';')
      .map(a => a.trim())
      .filter((a: string) => a.length > 0)
      .map((a: string) => a.endsWith('.') ? a : a + '.');
    
    if (answers.length === 0) return null;
    
    return { question: question.trim(), answers };
  }
  
  /**
   * True for a line that closes a capture session (docs/TODO.md §V, FR-TK-7/UI-1d): ends
   * with `.`, no `?` anywhere — a plain sentence, not another `Question? Answer1; ...`  line.
   */
  static isTerminatorLine(line: string): boolean {
    const trimmed = line.trim();
    return trimmed.endsWith('.') && !trimmed.includes('?');
  }

  /**
   * Assembles captured chat lines (docs/TODO.md §V, FR-TK-7) into a draft `flow` Talk.
   *
   * Each line's *first* answer continues to the next captured line (or becomes the terminal
   * match, if it's the last one); every other answer terminates as ignore — Bernard,
   * 2026-08-01: "first answer matches and goes further, the rest are ignored, keep it simple
   * enough." No synthetic "Ignore"/"Let's talk in person" buttons are appended — the captured
   * answers themselves carry the match/ignore split, via the same normalization every ordinary
   * flow talk already goes through (`TalkAutofix.fix`), not a parallel implementation of it.
   *
   * Returns a *draft* — `id` is left empty and `tags`/`authorId`/`authorLocation` are left for
   * the caller to fill in (FR-TG-6's mandatory tag/location preamble, and the real content-hash
   * id computed by `WebTalkService.createTalk`) — this function only shapes the questions.
   * Returns `null` if no line in the input actually parses as a captured question.
   */
  static assembleCapturedTalk(conversationLines: string[]): Talk | null {
    const questions = this.buildCapturedQuestions(conversationLines);
    if (questions.length === 0) return null;

    const draft: Talk = {
      id: '',
      title: questions[0].text.replace(/\?+\s*$/, '').trim() || 'Captured Talk',
      authorId: '',
      type: 'flow',
      isAdult: false,
      language: 'en',
      tags: [],
      questions,
      createdAt: new Date(),
      isTemplate: false,
      usageCount: 0,
    };

    return TalkAutofix.fix(draft).talk;
  }

  /**
   * The question-shaping half of `assembleCapturedTalk`, split out so the append case
   * (docs/TODO.md §V — captured lines typed into an *existing* talk's thread) can build new
   * `Question`s that don't collide with an existing talk's own `q_0`, `q_1`, ... ids.
   * `startIndex` offsets the generated ids; the caller is responsible for concatenating the
   * result onto the predecessor's `questions` and re-running `TalkAutofix.fix()` on the whole
   * merged array — `TalkAutofix` recomputes the entire chain from array order every time, so
   * the predecessor's previously-terminal last question is automatically redirected to link
   * into the appended ones rather than needing to be rewired by hand.
   */
  static buildCapturedQuestions(conversationLines: string[], startIndex = 0): Question[] {
    const questions: Question[] = [];
    let questionIndex = startIndex;

    for (const line of conversationLines) {
      const parsed = this.parseChatLine(line);
      if (!parsed) continue;

      const questionId = `q_${questionIndex}`;
      const answers: Answer[] = parsed.answers.map((text, i) => ({
        id: `${questionId}_a${i}`,
        text,
      }));
      questions.push({ id: questionId, text: parsed.question, answers });
      questionIndex++;
    }

    return questions;
  }
}

/**
 * docs/TODO.md §V — shapes the draft for a content edit that mints a new talk (as decided:
 * editing a talk's questions mints a new id and the edited version is treated as a fully
 * independent new `Talk`, linked back to its predecessor only for provenance).
 *
 * Pure — no id computation (the caller's `createTalk()` computes the real content-hash id)
 * and no `createdAt`/`authorLocation` (the caller stamps those fresh at submission time, the
 * same way any ordinary new talk does — this function only derives the *original*-side
 * fields and the supersession link). `questions` is supplied by the caller — this function
 * doesn't parse or transform them, so it works equally for the DM-shorthand append case and
 * an ordinary Talk Editor content edit.
 */
export function buildRevisedTalkDraft(
  oldTalk: Talk,
  questions: Question[],
  editorId: string,
  overrides: Partial<
    Pick<
      Talk,
      | 'title'
      | 'type'
      | 'language'
      | 'tags'
      | 'isAdult'
      | 'expiresAt'
      | 'locationRadiusMiles'
      | 'selfTag'
      | 'preferenceSet'
      | 'matchThreshold'
    >
  > = {},
): Partial<Talk> {
  const draft: Partial<Talk> = {
    id: '',
    title: overrides.title ?? oldTalk.title,
    authorId: editorId,
    type: overrides.type ?? oldTalk.type,
    isAdult: overrides.isAdult ?? oldTalk.isAdult,
    language: overrides.language ?? oldTalk.language,
    tags: overrides.tags ?? oldTalk.tags,
    questions,
    isTemplate: oldTalk.isTemplate,
    originalAuthorId: oldTalk.originalAuthorId ?? oldTalk.authorId,
    originalCreatedAt: oldTalk.originalCreatedAt ?? oldTalk.createdAt,
    supersedesTalkId: oldTalk.id,
  };

  const originalLocation = oldTalk.originalAuthorLocation ?? oldTalk.authorLocation;
  if (originalLocation) draft.originalAuthorLocation = originalLocation;

  const expiresAt = overrides.expiresAt !== undefined ? overrides.expiresAt : oldTalk.expiresAt;
  if (expiresAt != null) draft.expiresAt = expiresAt;

  const locationRadiusMiles =
    overrides.locationRadiusMiles !== undefined ? overrides.locationRadiusMiles : oldTalk.locationRadiusMiles;
  if (locationRadiusMiles != null) draft.locationRadiusMiles = locationRadiusMiles;

  const selfTag = overrides.selfTag !== undefined ? overrides.selfTag : oldTalk.selfTag;
  if (selfTag != null) draft.selfTag = selfTag;

  const preferenceSet = overrides.preferenceSet !== undefined ? overrides.preferenceSet : oldTalk.preferenceSet;
  if (preferenceSet != null) draft.preferenceSet = preferenceSet;

  const matchThreshold = overrides.matchThreshold !== undefined ? overrides.matchThreshold : oldTalk.matchThreshold;
  if (matchThreshold != null) draft.matchThreshold = matchThreshold;

  return draft;
}

/**
 * docs/TODO.md §V — a confirmed captured question line is sent as a marked payload, the same
 * pattern this codebase already uses for `IPFS_SHARE:` messages (`ui-manager.ts`'s
 * `parseIpfsSharePayload`/`renderIpfsAttachmentMessage`): an unambiguous prefix distinguishes
 * "this specific message is a confirmed capture" from plain text that merely *looks* like the
 * shorthand grammar. Without this, a sender who declines the confirmation and sends the exact
 * same text as an ordinary message would still have it silently re-render as tappable chips
 * for the recipient (whose own renderer re-parses raw text) — exactly the surprise the
 * mandatory-confirm decision exists to prevent. The confirmed/declined distinction has to
 * travel with the message, not be re-derived from its shape.
 */
export const CAPTURED_QUESTION_MESSAGE_PREFIX = 'CAPTURED_QUESTION:';

export type CapturedQuestionPayload = { question: string; answers: string[] };

export function encodeCapturedQuestionMessage(payload: CapturedQuestionPayload): string {
  return CAPTURED_QUESTION_MESSAGE_PREFIX + JSON.stringify(payload);
}

export function decodeCapturedQuestionMessage(text: string): CapturedQuestionPayload | null {
  const raw = String(text || '');
  if (!raw.startsWith(CAPTURED_QUESTION_MESSAGE_PREFIX)) return null;
  try {
    const parsed = JSON.parse(raw.slice(CAPTURED_QUESTION_MESSAGE_PREFIX.length));
    if (
      parsed &&
      typeof parsed.question === 'string' &&
      Array.isArray(parsed.answers) &&
      parsed.answers.every((a: unknown) => typeof a === 'string')
    ) {
      return { question: parsed.question, answers: parsed.answers };
    }
    return null;
  } catch {
    return null;
  }
}
