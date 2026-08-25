/** @jest-environment jsdom */

import { UIManager } from '../../web/ui/ui-manager';
import { initializeRouteEditorQuestions } from '../../web/ui/route-editor-model';

type PrivateRouteEditorUi = {
  routeEditorQuestions: Array<Record<string, any>>;
  renderRouteEditor: () => void;
  buildRouteSelfAnswers: (
    matchThreshold?: number,
  ) => Array<{ questionId: string; answerId: string }>;
  collectRouteEditorQuestions: () => { questions: Array<Record<string, any>>; errors: string[] };
};

function routeUi(): PrivateRouteEditorUi {
  return new UIManager() as unknown as PrivateRouteEditorUi;
}

describe('UIManager route-editor characterization', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="route-editor"></div>';
    localStorage.clear();
  });

  it('serializes a fan-out with ordered children, context paths, and its threshold', () => {
    const ui = routeUi();
    ui.routeEditorQuestions = [
      {
        id: 'root',
        text: 'Phone',
        parentAnswer: null,
        answers: [
          { id: 'phone', text: 'iPhone', parallelMatchThreshold: 1 },
          { id: 'ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
      },
      {
        id: 'model',
        text: 'Model',
        parentAnswer: { questionId: 'root', answerId: 'phone' },
        answers: [{ id: 'model-ok', text: '16 Pro', isMatch: true, isTerminal: true }],
      },
      {
        id: 'condition',
        text: 'Condition',
        parentAnswer: { questionId: 'root', answerId: 'phone' },
        answers: [{ id: 'condition-ok', text: 'Good', isMatch: true, isTerminal: true }],
      },
    ];

    const result = ui.collectRouteEditorQuestions();

    expect(result.errors).toEqual([]);
    expect(result.questions[0].answers[0]).toEqual({
      id: 'phone',
      text: 'iPhone',
      nextQuestionIds: ['model', 'condition'],
      parallelMatchThreshold: 1,
    });
    expect(result.questions[1].contextPath).toEqual([{ questionId: 'root', answerId: 'phone' }]);
    expect(result.questions[2].contextPath).toEqual([{ questionId: 'root', answerId: 'phone' }]);
  });

  it('rehydrates linking answers without misclassifying them as terminal', () => {
    const questions = initializeRouteEditorQuestions(
      {
        type: 'route',
        questions: [
          {
            id: 'root',
            text: 'Phone',
            contextPath: [],
            answers: [{ id: 'phone', text: 'iPhone', nextQuestionId: 'model' }],
          },
          {
            id: 'model',
            text: 'Model',
            contextPath: [{ questionId: 'root', answerId: 'phone' }],
            answers: [{ id: 'model-ok', text: '16 Pro', isMatch: true, isTerminal: true }],
          },
        ],
      },
      'Ignore.',
    );

    expect(questions[0].answers[0]).toMatchObject({
      id: 'phone',
      isTerminal: false,
    });
    expect(questions[1].parentAnswer).toEqual({ questionId: 'root', answerId: 'phone' });
    expect(questions[1].matchAnswerDirty).toBe(true);
  });

  it('keeps a built-in compatible branch and walks through it for author self-answers', () => {
    const ui = routeUi();
    ui.routeEditorQuestions = [
      {
        id: 'when',
        text: 'When',
        parentAnswer: null,
        answers: [],
        builtIn: {
          kind: 'timeFrame',
          timeFrame: { start: Date.UTC(2026, 7, 23), end: Date.UTC(2026, 7, 24) },
        },
      },
      {
        id: 'item',
        text: 'Item',
        parentAnswer: { questionId: 'when', answerId: 'when_compatible' },
        answers: [{ id: 'item-ok', text: 'Phone', isMatch: true, isTerminal: true }],
      },
    ];

    const result = ui.collectRouteEditorQuestions();

    expect(result.errors).toEqual([]);
    expect(result.questions[0].answers).toEqual([
      { id: 'when_compatible', text: 'Compatible', nextQuestionId: 'item' },
      { id: 'when_incompatible', text: 'Not compatible', isIgnore: true, isTerminal: true },
    ]);
    expect(ui.buildRouteSelfAnswers()).toEqual([{ questionId: 'item', answerId: 'item-ok' }]);
  });

  it('renders escaped values and mirrors an untouched single answer from question input', () => {
    const ui = routeUi();
    ui.routeEditorQuestions = [
      {
        id: 'root',
        text: '<script>unsafe()</script>',
        parentAnswer: null,
        answers: [
          { id: 'match', text: '', isMatch: true, isTerminal: true },
          { id: 'ignore', text: 'Ignore.', isIgnore: true, isTerminal: true },
        ],
        matchAnswerDirty: false,
      },
    ];

    ui.renderRouteEditor();

    expect(document.querySelector('#route-editor script')).toBeNull();
    const question = document.querySelector<HTMLInputElement>('.route-question-text')!;
    const answer = document.querySelector<HTMLInputElement>(
      '.route-answer-text[data-aid="match"]',
    )!;
    expect(question.value).toBe('<script>unsafe()</script>');

    question.value = 'iPhone';
    question.dispatchEvent(new Event('input', { bubbles: true }));

    expect(answer.value).toBe('iPhone');
    expect(ui.routeEditorQuestions[0].answers[0].text).toBe('iPhone');
  });
});
