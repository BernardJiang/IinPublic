import { Talk, Question, Answer, ContextStep, AnswerWithContext } from './types';
import { TalkStructureError, ValidationError } from './errors';
import { computeTalkIdFromTalkData } from './talk-content-id';

/** Answer record as submitted by the user (e.g. from talk response flow) */
export interface SubmittedAnswer {
  questionId: string;
  answerId: string;
  answerText?: string;
  isChecked?: boolean;
}

/**
 * Determines if the last submitted answer is a match (matching/tag talks).
 * Used by both frontend and backend so match logic lives in one place.
 */
export function checkIfMatch(talkData: Talk | any, answers: SubmittedAnswer[]): boolean {
  if (talkData.type !== 'matching' && talkData.type !== 'tag') {
    return false;
  }
  const lastAnswer = answers[answers.length - 1];
  if (!lastAnswer) return false;
  const question = talkData.questions?.find((q: any) => q.id === lastAnswer.questionId);
  if (!question) return false;
  const answer = question.answers?.find((a: any) => a.id === lastAnswer.answerId);
  if (!answer) return false;
  return answer.isMatch === true;
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
   *   matching → validateMatchingTalk (linear sequential Q/A)
   *   survey   → validateSurveyTalk   (independent Q/A)
   *   tree     → validateTreeTalk     (hierarchical DAG with context paths)
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

    if (talk.type === 'tree') {
      this.validateTreeTalk(talk);
      return;
    }

    if (talk.questions.length > 20) {
      throw new ValidationError('Talk cannot have more than 20 questions');
    }

    // Validate each question (skip for tag - validated in validateTagTalk)
    for (const question of talk.questions) {
      this.validateQuestion(question);
    }

    // Validate DAG structure
    this.validateDAGStructure(talk);

    // Validate survey-specific rules
    if (talk.type === 'survey') {
      this.validateSurveyTalk(talk);
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
    
    if (!question.text.endsWith('?')) {
      throw new ValidationError(`Question must end with '?' for question ${question.id}`);
    }
    
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
    
    if (!answer.text.endsWith('.')) {
      throw new ValidationError(`Answer must end with '.' for answer ${answer.id} in question ${questionId}`);
    }
  }
  
  private static validateSurveyTalk(talk: Talk): void {
    const aggregatableQuestions = talk.questions.filter(q => q.isAggregatable);

    if (aggregatableQuestions.length === 0) {
      throw new ValidationError('Survey talk must have at least one aggregatable question');
    }

    if (talk.questions.length > 15) {
      throw new ValidationError('Survey talk cannot have more than 15 questions');
    }
  }

  /**
   * Validates a tree talk (type === 'tree').
   *
   * Rules:
   * - Must have at least one question.
   * - Must not exceed 50 questions (tree talks can be large).
   * - Every question must have valid text and at least one answer.
   * - Every question must have a `contextPath` (root questions use []).
   * - No two questions may share the same (id, contextHash) pair.
   * - The graph must be a DAG (no cycles).
   * - contextPath entries must refer to questions and answers that actually
   *   exist in the talk.
   */
  private static validateTreeTalk(talk: Talk): void {
    if (talk.questions.length > 50) {
      throw new ValidationError('Tree talk cannot have more than 50 questions');
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

      // contextPath is mandatory on tree questions ([] for root questions)
      if (question.contextPath === undefined) {
        throw new ValidationError(
          `Tree question must have a contextPath (use [] for root questions): ${question.id}`
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
      const contextHash = TreeTalkProcessor.buildContextHash(question.contextPath);
      const uniqueKey = `${question.id}::${contextHash}`;
      if (seenContextKeys.has(uniqueKey)) {
        throw new ValidationError(
          `Duplicate (questionId, contextPath) combination for question ${question.id}`
        );
      }
      seenContextKeys.add(uniqueKey);
    }

    // DAG check — no cycles
    this.validateDAGStructure(talk);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TreeTalkProcessor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Utility class for working with tree-type talks.
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
export class TreeTalkProcessor {
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
   * - tag / survey / matching: pass [] for currentContext → hash is '' → matches
   *   any answer record with contextHash = '' (no-context answers).
   * - tree: pass the active ContextStep array → hash is computed → only the
   *   answer recorded under the exact same branch will match (FR-TK-12).
   *
   * @param questionId      The question the chatbot wants to answer.
   * @param currentContext  The context path active right now ([] for no-context).
   * @param storedAnswers   The user's auto-visibility AnswerWithContext records.
   * @returns               The matching record, or null if auto-reply is not possible.
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
   * Returns true if a question is a "survey-style" node in a tree talk —
   * i.e. its contextPath is empty (root-level) and it is answered without
   * any required prior context.
   */
  static isSurveyStyleNode(question: Question): boolean {
    return !question.contextPath || question.contextPath.length === 0;
  }
}

export class TalkLinearCapture {
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
   * Converts a chat conversation to a linear talk
   */
  static createLinearTalk(
    userId: string,
    conversationLines: string[],
    tags: string[] = [],
    _location?: string
  ): Talk {
    const questions: Question[] = [];
    let questionIndex = 0;
    
    for (const line of conversationLines) {
      const parsed = this.parseChatLine(line);
      if (!parsed) continue;
      
      const questionId = `q_${questionIndex}`;
      const answers: Answer[] = [];
      
      // Add parsed answers
      for (let i = 0; i < parsed.answers.length; i++) {
        const answer: Answer = {
          id: `a_${questionIndex}_${i}`,
          text: parsed.answers[i],
          isTerminal: questionIndex === conversationLines.length - 1,
          isIgnore: false,
          isMatch: false
        };
        if (questionIndex < conversationLines.length - 1) {
          answer.nextQuestionId = `q_${questionIndex + 1}`;
        }
        answers.push(answer);
      }
      
      // Always add "Ignore" option
      answers.push({
        id: `a_${questionIndex}_ignore`,
        text: 'Ignore.',
        isIgnore: true,
        isTerminal: true
      });
      
      const question: Question = {
        id: questionId,
        text: parsed.question,
        answers
      };
      if (questionIndex < conversationLines.length - 1) {
        question.nextQuestionId = `q_${questionIndex + 1}`;
      }
      questions.push(question);
      
      questionIndex++;
    }
    
    // Add "Let's talk in person" to final question
    if (questions.length > 0) {
      const finalQuestion = questions[questions.length - 1];
      finalQuestion.answers.push({
        id: `a_final_match`,
        text: "Let's talk in person.",
        isMatch: true,
        isTerminal: true
      });
    }
    
    const talk: Talk = {
      id: '',
      title: 'Auto-captured Talk',
      authorId: userId,
      type: 'matching',
      isAdult: false,
      language: 'en',
      tags: tags.map((t: string) => ({ id: t, name: t, category: 'other' as const, popularity: 0 })),
      questions,
      createdAt: new Date(),
      isTemplate: true,
      usageCount: 0
    };
    talk.id = computeTalkIdFromTalkData(talk);

    // Validate the generated talk
    TalkValidator.validateTalk(talk);
    
    return talk;
  }
}