/**
 * @jest-environment jsdom
 */
import { processTalkForm, detectTalkLanguage, type ProcessTalkFormDeps } from '../../web/ui/talk-form-processor';
import { addQuestionToForm, addAnswerToQuestion } from '../../web/ui/talk-editor-form-helpers';

function makeFormDOM(type: 'flow' | 'survey' | 'tag' | 'route' = 'tag'): HTMLFormElement {
  document.body.innerHTML = `
    <form id="talk-editor-form">
      <input id="talk-title" type="text" value="">
      <select id="talk-type">
        <option value="flow">flow</option>
        <option value="survey">survey</option>
        <option value="tag">tag</option>
        <option value="route">route</option>
      </select>
      <select id="talk-expires"><option value="">Never</option></select>
      <select id="talk-location-radius"><option value="">None</option></select>
      <input id="talk-send-to-chatroom" type="checkbox" checked>
      <input id="tag-pair-checkbox" type="checkbox">
      <input id="talk-answer" type="text" value="">
      <input id="tag-like-checkbox" type="checkbox" checked>
      <input id="talk-match-threshold" type="text" value="">
      <input id="talk-is-adult" type="checkbox">
      <input id="talk-attachment-input" type="file">
      <div id="questions-container"></div>
      <div id="talk-validation-group" style="display:none;">
        <div id="talk-validation-errors"></div>
        <div id="talk-autofix-banner"></div>
      </div>
    </form>
  `;
  (document.getElementById('talk-type') as HTMLSelectElement).value = type;
  return document.getElementById('talk-editor-form') as HTMLFormElement;
}

function makeDeps(overrides: Partial<ProcessTalkFormDeps> = {}): ProcessTalkFormDeps {
  return {
    getUiLanguage: () => 'en',
    getDefaultTalkLanguagePreference: () => 'en',
    t: (key) => String(key),
    emit: jest.fn(),
    showTalkValidationError: jest.fn(),
    showTalkAutofixReport: jest.fn(),
    refreshFlowAnswerConstraints: jest.fn(),
    collectRouteEditorQuestions: () => ({ questions: [], errors: [] }),
    buildRouteSelfAnswers: () => [],
    ...overrides,
  };
}

describe('processTalkForm', () => {
  it('creates a simple (self-match) tag talk and emits createTalk', () => {
    const form = makeFormDOM('tag');
    (document.getElementById('talk-title') as HTMLInputElement).value = 'Tennis';
    const deps = makeDeps();

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(true);
    expect(deps.showTalkValidationError).not.toHaveBeenCalled();
    expect(deps.emit).toHaveBeenCalledWith(
      'createTalk',
      expect.objectContaining({
        title: 'Tennis',
        type: 'tag',
        questions: [
          expect.objectContaining({
            text: 'Tennis',
            tagKind: 'simple',
            answers: expect.arrayContaining([
              expect.objectContaining({ text: 'Tennis', isMatch: true }),
            ]),
          }),
        ],
        selfAnswers: [{ questionId: 'q_0', answerId: 'a_0_match' }],
      }),
    );
  });

  it('creates a pair tag talk with a divergent accepted answer', () => {
    const form = makeFormDOM('tag');
    (document.getElementById('talk-title') as HTMLInputElement).value = 'buy';
    (document.getElementById('tag-pair-checkbox') as HTMLInputElement).checked = true;
    (document.getElementById('talk-answer') as HTMLInputElement).value = 'sell';
    const deps = makeDeps();

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(true);
    expect(deps.emit).toHaveBeenCalledWith(
      'createTalk',
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            text: 'buy',
            reciprocalTagContext: true,
            answers: expect.arrayContaining([expect.objectContaining({ text: 'sell', isMatch: true })]),
          }),
        ],
      }),
    );
  });

  it('rejects a tag talk with no keyword and never emits', () => {
    const form = makeFormDOM('tag');
    const deps = makeDeps();

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(false);
    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.showTalkValidationError).toHaveBeenCalledWith(['editorTagRequired']);
  });

  it('rejects a route talk when the route editor reports errors', () => {
    const form = makeFormDOM('route');
    (document.getElementById('talk-title') as HTMLInputElement).value = 'A route talk';
    const deps = makeDeps({
      collectRouteEditorQuestions: () => ({ questions: [], errors: ['root node missing'] }),
    });

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(false);
    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.showTalkValidationError).toHaveBeenCalledWith(['root node missing']);
  });

  it('blocks a talk whose title contains financial data before validating/emitting', () => {
    const form = makeFormDOM('tag');
    (document.getElementById('talk-title') as HTMLInputElement).value = '4111 1111 1111 1111';
    const deps = makeDeps();

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(false);
    expect(deps.emit).not.toHaveBeenCalled();
    expect(deps.showTalkValidationError).toHaveBeenCalledWith(['editorFinancialDataBlocked']);
  });

  it('creates a flow talk from real question/answer DOM built by talk-editor-form-helpers', () => {
    const form = makeFormDOM('flow');
    (document.getElementById('talk-title') as HTMLInputElement).value = 'Do you like coffee';
    const container = document.getElementById('questions-container') as HTMLElement;
    const helperOptions = { refreshFlowAnswerConstraints: jest.fn(), processTalkForm: jest.fn(() => true) };
    addQuestionToForm(0, container, helperOptions);
    const questionItem = container.querySelector('[data-question-index="0"]') as HTMLElement;
    (questionItem.querySelector('.question-text') as HTMLInputElement).value = 'Do you like coffee?';
    const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement;
    // addQuestionToForm already added one answer at index 0; fill it in as the match answer.
    const answerItem = answersContainer.querySelector('[data-answer-index="0"]') as HTMLElement;
    (answerItem.querySelector('.answer-text') as HTMLInputElement).value = 'Yes';
    (answerItem.querySelector('.answer-next') as HTMLSelectElement).value = 'noticed';
    // A second answer, left at its default `answer-next` ("ignore"), is the question's
    // required Ignore option — TalkValidator rejects a question with none.
    addAnswerToQuestion(answersContainer, 1, helperOptions);
    const ignoreAnswerItem = answersContainer.querySelector('[data-answer-index="1"]') as HTMLElement;
    (ignoreAnswerItem.querySelector('.answer-text') as HTMLInputElement).value = 'No';

    const deps = makeDeps();
    const ok = processTalkForm(form, deps);

    expect(ok).toBe(true);
    expect(deps.emit).toHaveBeenCalledWith(
      'createTalk',
      expect.objectContaining({
        title: 'Do you like coffee',
        type: 'flow',
        questions: [
          expect.objectContaining({
            text: 'Do you like coffee?',
            answers: expect.arrayContaining([expect.objectContaining({ text: 'Yes', isMatch: true })]),
          }),
        ],
      }),
    );
  });

  it('updates an existing talk (editingTalkId set) and emits updateTalk, not createTalk', () => {
    const form = makeFormDOM('tag');
    form.dataset.editingTalkId = 'talk-123';
    (document.getElementById('talk-title') as HTMLInputElement).value = 'Renamed Tag';
    const deps = makeDeps();

    const ok = processTalkForm(form, deps);

    expect(ok).toBe(true);
    expect(deps.emit).toHaveBeenCalledWith(
      'updateTalk',
      expect.objectContaining({ id: 'talk-123', title: 'Renamed Tag', type: 'tag' }),
    );
  });

  it('reports an autofix and still emits when TalkAutofix silently repairs the candidate', () => {
    // A tag talk whose author unchecked "Pair tag" but still typed a divergent #talk-answer
    // leaves the DOM answer word aside (processTalkForm's tag branch only reads #talk-answer
    // when isPairTag is true) — this exercises the ordinary self-match path instead, confirming
    // no autofix is needed for the common case and the report path is simply never invoked.
    const form = makeFormDOM('tag');
    (document.getElementById('talk-title') as HTMLInputElement).value = 'Hiking';
    const deps = makeDeps();

    processTalkForm(form, deps);

    expect(deps.showTalkAutofixReport).not.toHaveBeenCalled();
  });
});

describe('detectTalkLanguage', () => {
  it('detects CJK scripts directly from the text', () => {
    expect(detectTalkLanguage('こんにちは', 'en')).toBe('ja');
    expect(detectTalkLanguage('안녕하세요', 'en')).toBe('ko');
    expect(detectTalkLanguage('你好世界', 'en')).toBe('zh');
  });

  it('falls back to the provided default for short/ambiguous keyword titles', () => {
    expect(detectTalkLanguage('iPhone', 'zh')).toBe('zh');
  });

  it('detects a few Latin-script languages from stopwords/diacritics', () => {
    expect(detectTalkLanguage('Bonjour, comment allez-vous', 'en')).toBe('fr');
    expect(detectTalkLanguage('Hallo, wie geht es dir', 'en')).toBe('de');
    expect(detectTalkLanguage('Hola, como estas', 'en')).toBe('es');
  });
});
