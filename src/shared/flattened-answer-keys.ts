/**
 * Context keys for remembered user choices.
 *
 * A question context commits to the current question and its complete choice set. Flow/route
 * contexts additionally chain the immediately preceding question context and the answer chosen
 * there. The previous hash already commits to the complete earlier chain, so building the next
 * context is O(1); callers never need to hash the whole path again.
 */

import { normalizeIdentityText } from './cid';
import { portableSha256Hex } from './portable-sha256';

export const ANSWER_CONTEXT_VERSION = 2 as const;
const ANSWER_CONTEXT_DOMAIN = 'iinpublic-answer-context-v2';
const ROOT_CONTEXT = 'root';

export type QAPair = {
  questionId?: string;
  questionText: string;
  answerText: string;
  /** Context hash of `questionText` itself. Present on new runtime/session records. */
  contextHash?: string;
};

export type AnswerContextCursor = {
  /** Context hash of the immediately preceding question. */
  contextHash: string;
  /** User choice made under that context. */
  answerText: string;
};

export type ContextQuestion = {
  id?: string;
  text?: string;
  answers?: Array<{
    id?: string;
    text?: string;
    nextQuestionId?: string;
    nextQuestionIds?: string[];
  }>;
  nextQuestionId?: string;
  contextPath?: Array<{ questionId: string; answerId: string }>;
  reciprocalTagContext?: boolean;
  answerSelectionMode?: string;
};

/**
 * The user's own and counterpart tags are explicit structural context for reciprocal Pair tags.
 * They remain separate inputs because independently-authored reciprocal talks intentionally use
 * opposite surface wording while representing the same user-side situation.
 */
export type TagContext = { mySelfTag?: string | undefined; counterpartTag?: string | undefined };

function normalizedChoices(question: ContextQuestion): string[] {
  return [...new Set((question.answers || []).map((answer) => normalizeIdentityText(answer?.text)).filter(Boolean))]
    .sort();
}

/**
 * Produces the one authoritative context for a question.
 *
 * Root/tag questions and every independent survey question use `root` as their parent. Flow and
 * route questions use only the immediately preceding context hash and selected answer. Question
 * text, the whole order-insensitive choice set, selection mode, language, talk type, and Pair-tag
 * scope are committed into the same SHA-256 digest.
 */
export function buildQuestionContextHash(
  talk: { type?: string; language?: string },
  question: ContextQuestion,
  parent: AnswerContextCursor | undefined,
  tagContext?: TagContext,
): string {
  const isIndependent = talk?.type === 'survey';
  const payload = {
    version: ANSWER_CONTEXT_VERSION,
    domain: ANSWER_CONTEXT_DOMAIN,
    type: normalizeIdentityText(talk?.type || 'flow'),
    language: normalizeIdentityText(talk?.language || 'en'),
    parentContext: isIndependent ? ROOT_CONTEXT : (parent?.contextHash || ROOT_CONTEXT),
    previousAnswer: isIndependent ? '' : normalizeIdentityText(parent?.answerText),
    question: normalizeIdentityText(question?.text),
    choices: normalizedChoices(question),
    selectionMode: normalizeIdentityText(question?.answerSelectionMode || 'single'),
    selfTag: normalizeIdentityText(tagContext?.mySelfTag),
    counterpartTag: normalizeIdentityText(tagContext?.counterpartTag),
  };
  return portableSha256Hex(JSON.stringify(payload));
}

export function answerContextLookupKey(contextHash: string): string {
  return `flat_v${ANSWER_CONTEXT_VERSION}_${contextHash}`;
}

/**
 * Compatibility helper for callers/tests that still hold a list of prior Q/A pairs. New runtime
 * paths attach `contextHash` to every answered pair, so only the final pair is read. The fallback
 * loop exists solely to interpret an in-memory legacy call and is never persisted as v2 memory.
 */
export function buildAnswerPreferenceLookupKey(
  talk: { type?: string; language?: string; questions?: ContextQuestion[] },
  _talkContentHash: string,
  questionIndex: number,
  previousQAPairs: QAPair[],
  questionText: string,
  tagContext?: TagContext,
  currentQuestionOverride?: ContextQuestion,
): string {
  let parent: AnswerContextCursor | undefined;
  const last = previousQAPairs[previousQAPairs.length - 1];
  if (last?.contextHash) {
    parent = { contextHash: last.contextHash, answerText: last.answerText };
  } else if (talk?.type !== 'survey') {
    for (let i = 0; i < previousQAPairs.length; i += 1) {
      const pair = previousQAPairs[i];
      const question = (pair.questionId
        ? talk.questions?.find((candidate) => candidate.id === pair.questionId)
        : undefined)
        || talk.questions?.[i]
        || { text: pair.questionText, answers: [] };
      const contextHash = buildQuestionContextHash(
        talk,
        { ...question, text: pair.questionText || question.text || '' },
        parent,
        tagContext,
      );
      parent = { contextHash, answerText: pair.answerText };
    }
  }

  const indexedQuestion = talk.questions?.[questionIndex];
  const currentQuestion = currentQuestionOverride || {
    ...(indexedQuestion || {}),
    text: questionText || indexedQuestion?.text || '',
  };
  return answerContextLookupKey(buildQuestionContextHash(talk, currentQuestion, parent, tagContext));
}

export function sessionAnswersToQAPairs(
  talk: { questions?: Array<{ id: string; text?: string; reciprocalTagContext?: boolean }> },
  sessionAnswers: Array<{ questionId: string; answerText?: string; contextHash?: string }>,
): QAPair[] {
  const out: QAPair[] = [];
  for (const answer of sessionAnswers) {
    const question = talk.questions?.find((candidate) => candidate.id === answer.questionId);
    // Pair tags are represented by the normalized TagContext supplied to the context builder;
    // their inverse surface wording must not become a different rolling parent on each peer.
    if (question?.reciprocalTagContext) continue;
    out.push({
      ...(question?.id ? { questionId: question.id } : {}),
      questionText: (question?.text || '').trim(),
      answerText: (answer.answerText || '').trim(),
      ...(answer.contextHash ? { contextHash: answer.contextHash } : {}),
    });
  }
  return out;
}

/**
 * Returns only the immediate parent needed to build `currentQuestion`'s rolling context.
 *
 * This matters for route fan-out: previously answered sibling questions are not ancestors and
 * must never change one another's context. Route `contextPath` is authoritative when present;
 * flow links are used otherwise, with array order only as a compatibility fallback for older
 * linear talks. The returned parent already carries its own rolling hash, so the next context
 * remains O(1).
 */
export function immediateParentQAPairs(
  talk: { type?: string; questions?: ContextQuestion[] },
  currentQuestion: ContextQuestion,
  sessionAnswers: Array<{
    questionId: string;
    answerId?: string;
    answerText?: string;
    contextHash?: string;
  }>,
): QAPair[] {
  if (talk.type === 'survey') return [];
  const questions = talk.questions || [];
  let parentQuestionId: string | undefined;

  if (talk.type === 'route' && Array.isArray(currentQuestion.contextPath)) {
    parentQuestionId = currentQuestion.contextPath.at(-1)?.questionId;
  }

  if (!parentQuestionId) {
    for (let i = sessionAnswers.length - 1; i >= 0 && !parentQuestionId; i -= 1) {
      const sessionAnswer = sessionAnswers[i];
      const sourceQuestion = questions.find((candidate) => candidate.id === sessionAnswer.questionId);
      if (!sourceQuestion) continue;
      const selected = sourceQuestion.answers?.find((candidate) =>
        sessionAnswer.answerId
          ? candidate.id === sessionAnswer.answerId
          : normalizeIdentityText(candidate.text) === normalizeIdentityText(sessionAnswer.answerText),
      );
      if (
        sourceQuestion.nextQuestionId === currentQuestion.id
        || selected?.nextQuestionId === currentQuestion.id
        || selected?.nextQuestionIds?.includes(String(currentQuestion.id))
      ) {
        parentQuestionId = sourceQuestion.id;
      }
    }
  }

  if (!parentQuestionId && talk.type !== 'route') {
    const currentIndex = questions.findIndex((candidate) => candidate.id === currentQuestion.id);
    for (let i = currentIndex - 1; i >= 0; i -= 1) {
      if (sessionAnswers.some((answer) => answer.questionId === questions[i]?.id)) {
        parentQuestionId = questions[i]?.id;
        break;
      }
    }
  }

  if (!parentQuestionId) return [];
  const parentQuestion = questions.find((candidate) => candidate.id === parentQuestionId);
  if (parentQuestion?.reciprocalTagContext) return [];
  const parentAnswer = [...sessionAnswers].reverse().find((answer) => answer.questionId === parentQuestionId);
  if (!parentAnswer) return [];
  if (parentAnswer.contextHash) {
    return [{
      questionId: parentQuestionId,
      questionText: (parentQuestion?.text || '').trim(),
      answerText: (parentAnswer.answerText || '').trim(),
      contextHash: parentAnswer.contextHash,
    }];
  }

  // A pre-v2 response draft has no cursor hash. Reconstruct its active ancestry once so the next
  // user choice is saved under a correct v2 context; normal v2 runtime always takes the O(1)
  // branch above. Route contextPath is already ordered root→parent. Flow talks are linear, so the
  // answered prefix before the current question is the active ancestry.
  const ancestorIds = talk.type === 'route' && Array.isArray(currentQuestion.contextPath)
    ? currentQuestion.contextPath.map((step) => step.questionId)
    : questions
        .slice(0, questions.findIndex((candidate) => candidate.id === currentQuestion.id))
        .map((question) => question.id)
        .filter((id): id is string => Boolean(id));
  const pairs: QAPair[] = [];
  for (const questionId of ancestorIds) {
    const question = questions.find((candidate) => candidate.id === questionId);
    if (!question || question.reciprocalTagContext) continue;
    const answer = [...sessionAnswers].reverse().find((candidate) => candidate.questionId === questionId);
    if (!answer) continue;
    pairs.push({
      questionId,
      questionText: (question.text || '').trim(),
      answerText: (answer.answerText || '').trim(),
    });
  }
  return pairs;
}
