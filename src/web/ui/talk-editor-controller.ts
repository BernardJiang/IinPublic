import { escapeHtml } from './ui-formatters';
import { getAnswerPreferences } from './answer-preferences-storage';
import { getDefaultTalkLanguagePreference } from './ui-settings-storage';
import {
  addAnswerToQuestion,
  addQuestionToForm,
  appendIgnoreRow,
  applyBuiltInKindToQuestion,
  applyTagKindVisibilityToQuestion,
  collectFlowSurveyEditorQuestions,
  setupTalkFormHandlers,
  syncAdultLockFromBuiltInKinds,
  updateAllAnswerDropdowns,
} from './talk-editor-form-helpers';
import { showTalkEditorDialog as openTalkEditorDialog } from './talk-editor-dialog';
import { showTalkTemplatePicker as renderTalkTemplatePicker } from './talk-template-picker';
import { refreshFlowAnswerConstraints as refreshFlowConstraints } from './flow-answer-constraints';
import {
  buildRouteSelfAnswers,
  collectRouteEditorQuestions,
  initializeRouteEditorQuestions,
  type RouteEditorQuestion,
} from './route-editor-model';
import { renderRouteEditor } from './route-editor-controller';
import { processTalkForm as processForm } from './talk-form-processor';
import type { UiLanguage } from './ui-translations';

export type TalkEditorControllerDeps = {
  getCurrentUserId: () => string;
  getUiLanguage: () => UiLanguage;
  emit: (event: string, payload: unknown) => void;
  t: (key: any) => string;
  hydrateAttachmentImages: (container: HTMLElement) => void;
};

export type TalkEditorController = ReturnType<typeof createTalkEditorController>;

export function createTalkEditorController(deps: TalkEditorControllerDeps) {
  let routeQuestions: RouteEditorQuestion[] = [];

  const refreshFlowAnswerConstraints = (type: string): void => {
    refreshFlowConstraints(type, { t: deps.t });
  };

  const renderRouteEditorView = (): void => {
    const host = document.getElementById('route-editor');
    if (!host) return;
    renderRouteEditor(host, {
      getQuestions: () => routeQuestions,
      replaceQuestions: (questions) => { routeQuestions = questions; },
      text: deps.t,
    });
  };

  const ensureRouteEditorRendered = (existingTalk?: any): void => {
    if (!document.getElementById('route-editor')) return;
    if (routeQuestions.length === 0) routeQuestions = initializeRouteEditorQuestions(existingTalk);
    renderRouteEditorView();
  };

  const collectRouteQuestions = (): ReturnType<typeof collectRouteEditorQuestions> =>
    collectRouteEditorQuestions(routeQuestions, deps.t);

  const buildSelfAnswers = (matchThreshold?: number): { questionId: string; answerId: string }[] =>
    buildRouteSelfAnswers(routeQuestions, matchThreshold);

  const showValidationError = (errors: string[]): void => {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const errorBox = document.getElementById('talk-validation-errors');
    if (!errorBox) return;
    errorBox.style.display = 'block';
    errorBox.innerHTML = `<strong>${escapeHtml(deps.t('editorCannotSave'))}</strong><ul style="margin:6px 0 0 16px; padding:0;">`
      + errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')
      + '</ul>';
    errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const showAutofixReport = (fixes: string[]): void => {
    const group = document.getElementById('talk-validation-group');
    if (group) group.style.display = 'block';
    const banner = document.getElementById('talk-autofix-banner');
    if (!banner) return;
    banner.style.display = 'block';
    banner.innerHTML = `<strong>${escapeHtml(deps.t('editorAutoFixed'))}</strong><ul style="margin:6px 0 0 16px; padding:0;">`
      + fixes.map((fix) => `<li>${escapeHtml(fix)}</li>`).join('')
      + '</ul>';
  };

  const processTalkForm = (form: HTMLFormElement): boolean => processForm(form, {
    getUiLanguage: deps.getUiLanguage,
    getDefaultTalkLanguagePreference,
    t: deps.t,
    emit: deps.emit,
    showTalkValidationError: showValidationError,
    showTalkAutofixReport: showAutofixReport,
    refreshFlowAnswerConstraints,
    collectRouteEditorQuestions: collectRouteQuestions,
    buildRouteSelfAnswers: buildSelfAnswers,
  });

  const formHelperOptions = () => ({
    refreshFlowAnswerConstraints,
    processTalkForm,
    text: deps.t,
  });

  const updateAnswerDropdowns = (): void => {
    updateAllAnswerDropdowns(formHelperOptions());
  };

  const showTalkTemplatePicker = (): void => {
    renderTalkTemplatePicker({
      t: deps.t,
      openEditor: (existingTalk) => showTalkEditorDialog(existingTalk),
    });
  };

  const showTalkEditorDialog = (existingTalk?: any): void => {
    routeQuestions = [];
    openTalkEditorDialog({
      existingTalk,
      currentUserId: deps.getCurrentUserId(),
      text: deps.t,
      escapeHtml,
      getAnswerPreferences,
      addQuestionToForm: (index, container) => addQuestionToForm(index, container, formHelperOptions()),
      addAnswerToQuestion: (container, index) => addAnswerToQuestion(container, index, formHelperOptions()),
      appendIgnoreRow: (container, index) => appendIgnoreRow(container, index, formHelperOptions()),
      applyBuiltInKindToQuestion,
      applyTagKindVisibilityToQuestion,
      updateAllAnswerDropdowns: updateAnswerDropdowns,
      refreshFlowAnswerConstraints,
      ensureRouteEditorRendered,
      setupTalkFormHandlers: (modal) => setupTalkFormHandlers(modal, formHelperOptions()),
      syncAdultLockFromBuiltInKinds,
      hydrateAttachmentImages: deps.hydrateAttachmentImages,
      onBrowseTemplates: showTalkTemplatePicker,
      previewCollectors: {
        collectFlowSurveyEditorQuestions: (previewType) => collectFlowSurveyEditorQuestions(
          document.getElementById('talk-editor-form') as HTMLFormElement,
          previewType,
          formHelperOptions(),
        ).questions,
        collectRouteEditorQuestions: () => collectRouteQuestions().questions,
      },
    });
  };

  return {
    buildRouteSelfAnswers: buildSelfAnswers,
    collectRouteEditorQuestions: collectRouteQuestions,
    getRouteEditorQuestions: () => routeQuestions,
    processTalkForm,
    renderRouteEditor: renderRouteEditorView,
    setRouteEditorQuestions: (questions: RouteEditorQuestion[]) => { routeQuestions = questions; },
    showTalkEditorDialog,
  };
}
