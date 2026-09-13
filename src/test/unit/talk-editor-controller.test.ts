/** @jest-environment jsdom */

import {
  createTalkEditorController,
  type TalkEditorControllerDeps,
} from '../../web/ui/talk-editor-controller';
import { showTalkEditorDialog } from '../../web/ui/talk-editor-dialog';
import { showTalkTemplatePicker } from '../../web/ui/talk-template-picker';

jest.mock('../../web/ui/talk-editor-dialog', () => ({
  showTalkEditorDialog: jest.fn(),
}));
jest.mock('../../web/ui/talk-template-picker', () => ({
  showTalkTemplatePicker: jest.fn(),
}));

const openEditor = showTalkEditorDialog as jest.MockedFunction<typeof showTalkEditorDialog>;
const openTemplatePicker = showTalkTemplatePicker as jest.MockedFunction<typeof showTalkTemplatePicker>;

function makeDeps(overrides: Partial<TalkEditorControllerDeps> = {}): TalkEditorControllerDeps {
  return {
    getCurrentUserId: () => 'self',
    getUiLanguage: () => 'en',
    emit: jest.fn(),
    t: (key) => String(key),
    ...overrides,
  };
}

describe('talk editor controller', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="route-editor"></div>';
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('owns route state and serializes it through the extracted model boundary', () => {
    const controller = createTalkEditorController(makeDeps());
    controller.setRouteEditorQuestions([
      {
        id: 'root',
        text: 'Phone',
        parentAnswer: null,
        answers: [{ id: 'match', text: 'iPhone', isMatch: true, isTerminal: true }],
      },
    ]);

    expect(controller.getRouteEditorQuestions()).toHaveLength(1);
    expect(controller.collectRouteEditorQuestions()).toEqual({
      questions: [expect.objectContaining({ id: 'root', text: 'Phone' })],
      errors: [],
    });
    expect(controller.buildRouteSelfAnswers()).toEqual([{ questionId: 'root', answerId: 'match' }]);
  });

  it('resets stale route state and supplies the complete dialog integration contract', () => {
    const controller = createTalkEditorController(makeDeps());
    controller.setRouteEditorQuestions([
      { id: 'stale', text: 'Old', parentAnswer: null, answers: [] },
    ]);

    controller.showTalkEditorDialog({ id: 'talk-1', authorId: 'self', title: 'Existing' });

    expect(controller.getRouteEditorQuestions()).toEqual([]);
    expect(openEditor).toHaveBeenCalledWith(expect.objectContaining({
      currentUserId: 'self',
      existingTalk: expect.objectContaining({ id: 'talk-1' }),
      ensureRouteEditorRendered: expect.any(Function),
      setupTalkFormHandlers: expect.any(Function),
      previewCollectors: expect.objectContaining({
        collectFlowSurveyEditorQuestions: expect.any(Function),
        collectRouteEditorQuestions: expect.any(Function),
      }),
    }));
  });

  it('keeps template selection inside the editor controller and reopens the chosen draft', () => {
    const controller = createTalkEditorController(makeDeps());
    controller.showTalkEditorDialog();
    const dialogOptions = openEditor.mock.calls[0][0];

    dialogOptions.onBrowseTemplates?.();
    expect(openTemplatePicker).toHaveBeenCalledWith(expect.objectContaining({
      openEditor: expect.any(Function),
    }));

    const templateOptions = openTemplatePicker.mock.calls[0][0];
    templateOptions.openEditor({ title: 'Template draft', type: 'tag' });
    expect(openEditor).toHaveBeenCalledTimes(2);
    expect(openEditor.mock.calls[1][0].existingTalk).toEqual(
      expect.objectContaining({ title: 'Template draft' }),
    );
  });
});
