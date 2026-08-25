import type { Answer, BuiltInQuestionSpec, ContextStep, Question, Talk } from '../../shared/types';
import type { UiTranslationKey } from './ui-translations';

export interface RouteEditorAnswer {
  id: string;
  text: string;
  isMatch?: boolean;
  isIgnore?: boolean;
  isTerminal?: boolean;
  /** Only meaningful when this answer has two or more child questions. */
  parallelMatchThreshold?: number;
}

export interface RouteEditorQuestion {
  id: string;
  text: string;
  parentAnswer: ContextStep | null;
  answers: RouteEditorAnswer[];
  builtIn?: BuiltInQuestionSpec;
  reciprocalTagContext?: boolean;
  tagKind?: 'simple';
  /** False until the author edits the accepted answer independently of the question text. */
  matchAnswerDirty?: boolean;
}

export type RouteEditorText = (key: UiTranslationKey) => string;

type ExistingRouteTalk = Pick<Talk, 'type' | 'questions'>;

/**
 * Creates the editor-owned mutable model. Existing talks retain their authored answer text and
 * recover each node's immediate parent from its final context-path step.
 */
export function initializeRouteEditorQuestions(
  existingTalk: ExistingRouteTalk | null | undefined,
  defaultIgnoreText: string,
): RouteEditorQuestion[] {
  if (existingTalk?.type === 'route' && Array.isArray(existingTalk.questions)) {
    return existingTalk.questions.map((question) => ({
      id: question.id,
      text: question.text,
      parentAnswer:
        Array.isArray(question.contextPath) && question.contextPath.length > 0
          ? { ...question.contextPath[question.contextPath.length - 1] }
          : null,
      answers: (question.answers || []).map((answer) => ({
        id: answer.id,
        text: answer.text,
        isMatch: !!answer.isMatch,
        isIgnore: !!answer.isIgnore,
        // Linking answers carry neither terminal nor outcome flags. Do not let the historical
        // default-to-terminal behavior misclassify them when an existing route is reopened.
        isTerminal:
          !answer.nextQuestionId &&
          !(Array.isArray(answer.nextQuestionIds) && answer.nextQuestionIds.length > 0) &&
          answer.isTerminal !== false,
        ...(typeof answer.parallelMatchThreshold === 'number'
          ? { parallelMatchThreshold: answer.parallelMatchThreshold }
          : {}),
      })),
      ...(question.builtIn ? { builtIn: question.builtIn } : {}),
      ...(question.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
      ...(question.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
      // Rehydrated text is already authored and must not be overwritten by question mirroring.
      matchAnswerDirty: true,
    }));
  }

  return [
    {
      id: 'q_0',
      text: '',
      parentAnswer: null,
      answers: [
        { id: 'a_0_match', text: '', isMatch: true, isTerminal: true },
        { id: 'a_0_ignore', text: defaultIgnoreText, isIgnore: true, isTerminal: true },
      ],
      matchAnswerDirty: false,
    },
  ];
}

function childQuestionIdsByParentAnswer(
  questions: readonly RouteEditorQuestion[],
): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const question of questions) {
    if (!question.parentAnswer) continue;
    const key = `${question.parentAnswer.questionId}::${question.parentAnswer.answerId}`;
    const ids = children.get(key) ?? [];
    ids.push(question.id);
    children.set(key, ids);
  }
  return children;
}

/**
 * Selects the author's implicit route answers. Fan-outs visit every first-answer branch. A
 * built-in node has no authored self-answer, but traversal continues through its compatible edge.
 */
export function buildRouteSelfAnswers(
  questions: readonly RouteEditorQuestion[],
  matchThreshold?: number,
): Array<{ questionId: string; answerId: string }> {
  const children = childQuestionIdsByParentAnswer(questions);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const root = questions.find((question) => !question.parentAnswer);
  const selfAnswers: Array<{ questionId: string; answerId: string }> = [];

  if (matchThreshold != null && root) {
    for (const answer of root.answers) {
      const childIds = children.get(`${root.id}::${answer.id}`) ?? [];
      for (const childId of childIds) {
        const child = byId.get(childId);
        if (!child || child.builtIn || child.answers.length === 0) continue;
        selfAnswers.push({ questionId: child.id, answerId: child.answers[0].id });
      }
    }
    return selfAnswers;
  }

  const visit = (question: RouteEditorQuestion | undefined): void => {
    if (!question) return;
    if (question.builtIn) {
      const childIds = children.get(`${question.id}::${question.id}_compatible`) ?? [];
      for (const childId of childIds) visit(byId.get(childId));
      return;
    }
    if (question.answers.length === 0) return;
    const firstAnswer = question.answers[0];
    selfAnswers.push({ questionId: question.id, answerId: firstAnswer.id });
    const childIds = children.get(`${question.id}::${firstAnswer.id}`) ?? [];
    for (const childId of childIds) visit(byId.get(childId));
  };

  visit(root);
  return selfAnswers;
}

export interface CollectedRouteEditorQuestions {
  questions: Question[];
  errors: string[];
}

/** Converts the editor model into validator-ready route questions without touching the DOM. */
export function collectRouteEditorQuestions(
  editorQuestions: readonly RouteEditorQuestion[],
  text: RouteEditorText,
): CollectedRouteEditorQuestions {
  const byId = new Map(editorQuestions.map((question) => [question.id, question]));
  const computeContextPath = (questionId: string): ContextStep[] => {
    const path: ContextStep[] = [];
    let current = byId.get(questionId);
    while (current?.parentAnswer) {
      path.unshift({ ...current.parentAnswer });
      current = byId.get(current.parentAnswer.questionId);
    }
    return path;
  };
  const children = childQuestionIdsByParentAnswer(editorQuestions);
  const errors: string[] = [];

  const questions: Question[] = editorQuestions.map((question) => {
    const contextPath = computeContextPath(question.id);
    if (question.builtIn) {
      const kind = question.builtIn.kind;
      if (kind === 'quantity' && !Number.isFinite(question.builtIn.quantity)) {
        errors.push(text('editorBuiltInQuantityRequired'));
      } else if (kind === 'priceRange') {
        const range = question.builtIn.priceRange;
        if (
          !range ||
          !Number.isFinite(range.min) ||
          !Number.isFinite(range.max) ||
          range.min > range.max
        ) {
          errors.push(text('editorBuiltInPriceRangeRequired'));
        }
      } else if (kind === 'timeFrame') {
        const range = question.builtIn.timeFrame;
        if (
          !range ||
          !Number.isFinite(range.start) ||
          !Number.isFinite(range.end) ||
          range.start > range.end
        ) {
          errors.push(text('editorBuiltInTimeFrameRequired'));
        }
      }

      const compatibleId = `${question.id}_compatible`;
      const childIds = children.get(`${question.id}::${compatibleId}`) ?? [];
      const compatibleAnswer: Answer = { id: compatibleId, text: 'Compatible' };
      if (childIds.length === 1) {
        compatibleAnswer.nextQuestionId = childIds[0];
      } else if (childIds.length > 1) {
        compatibleAnswer.nextQuestionIds = childIds;
      } else {
        compatibleAnswer.isMatch = true;
        compatibleAnswer.isTerminal = true;
      }

      return {
        id: question.id,
        text: question.text.trim(),
        contextPath,
        answers: [
          compatibleAnswer,
          {
            id: `${question.id}_incompatible`,
            text: 'Not compatible',
            isIgnore: true,
            isTerminal: true,
          },
        ],
        builtIn: question.builtIn,
        ...(question.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
        ...(question.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
      };
    }

    return {
      id: question.id,
      text: question.text.trim(),
      contextPath,
      answers: question.answers.map((answer): Answer => {
        const collected: Answer = { id: answer.id, text: answer.text.trim() };
        const childIds = children.get(`${question.id}::${answer.id}`) ?? [];
        if (childIds.length === 1) {
          collected.nextQuestionId = childIds[0];
        } else if (childIds.length > 1) {
          collected.nextQuestionIds = childIds;
          if (typeof answer.parallelMatchThreshold === 'number') {
            collected.parallelMatchThreshold = answer.parallelMatchThreshold;
          }
        } else {
          if (answer.isMatch) collected.isMatch = true;
          if (answer.isIgnore) collected.isIgnore = true;
          if (answer.isTerminal) collected.isTerminal = true;
        }
        return collected;
      }),
      ...(question.reciprocalTagContext ? { reciprocalTagContext: true } : {}),
      ...(question.tagKind === 'simple' ? { tagKind: 'simple' as const } : {}),
    };
  });

  return { questions, errors };
}
