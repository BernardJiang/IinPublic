import type { UiTranslationKey } from './ui-translations';
import {
  createSeededTagOppositePairRegistryState,
  getOppositeTagName,
  questionTemplateForTag,
  type TagOppositePairRegistryState,
} from '../../shared/tag-opposite-pairs';

// docs/TODO.md §LL: shared auto-fill/lock/preview behavior for a tag-word input and its
// accepted-answer counterpart — used by both `#talk-tag`/`#talk-preference-set` (flow/route
// selfTag + preferenceSet) and `#talk-title`/`#talk-answer` (tag-type keyword + answer). Typing
// into the source keeps auto-driving the answer field with the seeded opposite tag (buy → sell,
// live) until the author gives the answer field a value of their own — either by typing into it
// directly, or by opening the editor on an existing talk that already carries an explicit
// `preferenceSet`. With no known opposite, the answer defaults to the SAME word as the source
// (self-match — "Tennis" matches anyone else tagged "Tennis"), not a blank "matches anyone"
// state; §LL retired that as a distinct concept.
function wireTagAnswerAutoFill(config: {
  sourceInput: HTMLInputElement | null;
  answerInput: HTMLInputElement | null;
  previewEl: HTMLElement | null;
  registry: TagOppositePairRegistryState;
  initiallyLocked: boolean;
  selfMatchPreviewText: (tag: string) => string;
  oppositePreviewText: (answer: string) => string;
}): void {
  let locked = config.initiallyLocked;

  const renderPreview = (): void => {
    if (!config.previewEl) return;
    const sourceValue = config.sourceInput?.value.trim() || '';
    if (!sourceValue) {
      config.previewEl.textContent = '';
      return;
    }
    const answerValue = config.answerInput?.value.trim() || sourceValue;
    config.previewEl.textContent = answerValue === sourceValue
      ? config.selfMatchPreviewText(sourceValue)
      : config.oppositePreviewText(answerValue);
  };

  const onSourceInput = (): void => {
    const sourceValue = config.sourceInput?.value.trim() || '';
    if (sourceValue && config.answerInput && !locked) {
      const opposite = getOppositeTagName(config.registry, sourceValue);
      config.answerInput.value = opposite || sourceValue;
    }
    renderPreview();
  };

  config.sourceInput?.addEventListener('input', onSourceInput);
  config.answerInput?.addEventListener('input', () => {
    locked = true;
    renderPreview();
  });
  onSourceInput();
}

type TalkEditorDialogOptions = {
  existingTalk?: any;
  /**
   * docs/TODO.md §Y1 — whether `existingTalk` (if any) is already authored by the person
   * opening the editor. When it isn't (a copied-but-unedited incoming talk), the form must
   * NOT submit through the "update in place" path — that would either silently fail (this
   * user never locally created the source talk) or, worse, save an edited version while still
   * leaving `authorId` as the original sender's (`WebTalkService.updateTalk` deliberately never
   * reassigns authorship, correct for a real self-owned edit, wrong here). Editing a copy must
   * go through the same mint-a-new-talk-and-transfer-credit path §V already built.
   */
  currentUserId?: string;
  escapeHtml: (text: string) => string;
  getAnswerPreferences: () => Record<string, any>;
  addQuestionToForm: (index: number, container: HTMLElement) => void;
  addAnswerToQuestion: (container: HTMLElement, index: number) => void;
  appendIgnoreRow: (container: HTMLElement, qIndex: number) => void;
  applyBuiltInKindToQuestion: (questionItem: HTMLElement, kind: string) => void;
  updateAllAnswerDropdowns: () => void;
  refreshFlowAnswerConstraints: (type: string) => void;
  ensureRouteEditorRendered: (existingTalk?: any) => void;
  setupTalkFormHandlers: (modal: HTMLElement) => void;
  defaultLanguage?: string;
  languageOptions?: Array<{ code: string; label: string }>;
  text?: (key: UiTranslationKey) => string;
};

export function showTalkEditorDialog(options: TalkEditorDialogOptions): void {
  const { existingTalk } = options;
  const text = (key: UiTranslationKey, fallback: string): string => options.text?.(key) || fallback;
  const format = (key: UiTranslationKey, fallback: string, values: Record<string, string | number>): string =>
    Object.entries(values).reduce(
      (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
      text(key, fallback),
    );
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'talk-editor-modal';
  // docs/TODO.md §Y1: only a talk this user already authored counts as "editing in place" —
  // a copied-but-not-yet-edited talk (existingTalk.authorId belongs to someone else) still
  // pre-fills the form, but must fall through to the create-a-new-talk path on submit.
  const isOwnedEdit = !!(existingTalk?.id && (!existingTalk.authorId || existingTalk.authorId === options.currentUserId));
  if (isOwnedEdit) {
    (modal as HTMLElement).dataset.editingTalkId = existingTalk.id;
  }

  const renderForm = (): void => {
    const isEdit = !!(existingTalk && existingTalk.id);
    const languageOptions = options.languageOptions || [
      { code: 'en', label: 'English' },
      { code: 'zh', label: 'Chinese' },
      { code: 'es', label: 'Spanish' },
      { code: 'fr', label: 'French' },
      { code: 'de', label: 'German' },
      { code: 'ja', label: 'Japanese' },
      { code: 'ko', label: 'Korean' },
    ];
    const selectedLanguage = String(existingTalk?.language || options.defaultLanguage || 'en').toLowerCase();
    modal.innerHTML = `
      <div class="modal-content size-xl modal-fullscreen" style="max-width: 1000px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">${isEdit ? text('editorEditTitle', 'Edit Talk') : text('editorCreateTitle', 'Create a Talk')}</h2>
          <p class="talk-editor-description">${text('editorDescription', 'Build a branching conversation flow - each answer can lead to a different question')}</p>
        </div>
        <form id="talk-editor-form" style="padding: 20px;" data-editing-talk-id="${isOwnedEdit ? existingTalk.id : ''}" data-revise-source-talk="${!isOwnedEdit && existingTalk?.id ? options.escapeHtml(JSON.stringify(existingTalk)) : ''}">
          <div class="form-group">
            <label class="form-label">${text('editorTalkTitle', 'Talk Title')}</label>
            <input type="text" class="form-input" id="talk-title" placeholder="${text('editorTitlePlaceholder', 'e.g., Coffee Meetup, Quick Survey')}" required value="${existingTalk ? options.escapeHtml(existingTalk.title) : ''}">
          </div>

          <div class="form-group">
            <label class="form-label">${text('editorLanguage', 'Language')}</label>
            <select class="form-input" id="talk-language" aria-label="Talk language">
              ${languageOptions
                .map((lang) => `<option value="${lang.code}" ${lang.code === selectedLanguage ? 'selected' : ''}>${lang.label}</option>`)
                .join('')}
            </select>
          </div>

          <div class="form-group" id="tag-like-group" style="display: none;">
            <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="tag-like-checkbox" checked aria-label="${text('editorTagLike', 'I like this tag')}">
              <span>${text('editorTagLike', 'I like this tag')}</span>
            </label>
          </div>

          <div class="form-group" id="tag-answer-group" style="display: none;">
            <label class="form-label" for="talk-answer">${text('editorTagAnswerLabel' as UiTranslationKey, "Accepted answer (optional — defaults to the tag word itself)")}</label>
            <input
              type="text"
              class="form-input"
              id="talk-answer"
              value="${options.escapeHtml(existingTalk?.preferenceSet?.[0] || '')}"
              placeholder="${text('editorTagAnswerPlaceholder' as UiTranslationKey, "e.g. sell — or leave as the same word to match fellow buy people")}"
            >
            <p id="talk-answer-preview" style="margin: 6px 0 0 0; font-size: 0.85em; color: #666;"></p>
          </div>

          <div class="form-group">
            <label class="form-label">${text('editorType', 'Type')}</label>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="tag" ${existingTalk?.type === 'tag' || !existingTalk ? 'checked' : ''}>
                <span>${text('editorTagOption', 'Tag (single keyword; answer with one checkbox - match or ignore)')}</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="flow" ${existingTalk?.type === 'flow' ? 'checked' : ''}>
                <span>${text('editorFlowOption', 'Flow - sequential questions that find compatible people')}</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="survey" ${existingTalk?.type === 'survey' ? 'checked' : ''}>
                <span>${text('editorSurveyOption', 'Survey - independent questions that collect aggregate counts')}</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="route" ${existingTalk?.type === 'route' ? 'checked' : ''}>
                <span>${text('editorRouteOption', 'Route - branching DAG of questions (tree editor)')}</span>
              </label>
            </div>
            <select class="form-input" id="talk-type" aria-hidden="true" style="position: absolute; left: -9999px;" tabindex="-1">
              <option value="tag">Tag</option>
              <option value="flow">Flow</option>
              <option value="survey">Survey</option>
              <option value="route">Route</option>
            </select>
          </div>

          <div class="form-group" id="talk-tag-group">
            <label class="form-label" for="talk-tag">${text('editorTagPairLabel', 'What is this? (optional)')}</label>
            <input
              type="text"
              class="form-input"
              id="talk-tag"
              value="${options.escapeHtml(existingTalk?.tags?.[0]?.name || '')}"
              placeholder="${text('editorTagPairPlaceholder', 'e.g. buy, sell, hiring, jobseeking')}"
              list="talk-tag-suggestions"
            >
            <datalist id="talk-tag-suggestions">
              <option value="buy"></option>
              <option value="sell"></option>
              <option value="hiring"></option>
              <option value="jobseeking"></option>
            </datalist>
            <label class="form-label" for="talk-preference-set" style="margin-top: 10px; display: block;">${text('editorPreferenceSetLabel' as UiTranslationKey, 'Who can respond? (optional — leave blank to auto-fill the opposite tag)')}</label>
            <input
              type="text"
              class="form-input"
              id="talk-preference-set"
              value="${options.escapeHtml((existingTalk?.preferenceSet || []).join(', '))}"
              placeholder="${text('editorPreferenceSetPlaceholder' as UiTranslationKey, 'e.g. sell, offer, free — or type your own tag again to match fellow buy people')}"
            >
            <p id="talk-tag-preview" style="margin: 6px 0 0 0; font-size: 0.85em; color: #666;"></p>
          </div>

          <div class="form-group" id="questions-form-group">
            <label class="form-label" id="questions-form-label">${text('editorQuestions', 'Questions & Branching')}</label>
            <p class="talk-editor-type-hint" id="talk-editor-type-hint" style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;"></p>
            <div id="questions-container"></div>
            <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: var(--accent); color: white;">${text('editorAddQuestion', '+ Add Question')}</button>
          </div>

          <div class="form-group" id="route-form-group" style="display: none;">
            <label class="form-label">${text('editorRouteTitle', 'Route (DAG editor)')}</label>
            <p style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;">
              ${text('editorRouteHelp', 'Build a branching tree. Each answer can lead to a follow-up question. On any path from root to leaf, the same question cannot appear twice; it may appear in separate branches with separate context ids.')}
            </p>
            <div id="route-editor"></div>
            <label class="form-label" for="talk-match-threshold" style="margin-top: 14px; display: block;">${text('editorMatchThresholdLabel' as UiTranslationKey, 'Match threshold (optional)')}</label>
            <p style="margin: 0 0 8px 0; font-size: 0.85em; color: #666;">
              ${text('editorMatchThresholdHelp' as UiTranslationKey, 'Treats every direct branch off the root as an independent spec, answerable in any order. A responder matches once at least this many specs match — a partial match still counts. Leave blank for the default: only the terminal answer on the path taken decides.')}
            </p>
            <input
              type="number"
              class="form-input"
              id="talk-match-threshold"
              min="1"
              step="1"
              value="${existingTalk?.matchThreshold != null ? existingTalk.matchThreshold : ''}"
              placeholder="${text('editorMatchThresholdPlaceholder' as UiTranslationKey, 'e.g. 2')}"
              style="max-width: 140px;"
            >
            <div id="talk-validation-errors" class="talk-validation-errors" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid var(--danger); background: var(--danger-soft); color: var(--danger-hover); border-radius: 6px; font-size: 0.9em;"></div>
          </div>

          <div class="form-group" id="talk-validation-group" style="display: none;">
            <div id="talk-autofix-banner" class="talk-autofix-banner" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid var(--success); background: var(--success-soft); color: var(--success-text); border-radius: 6px; font-size: 0.9em;"></div>
          </div>

          <div class="form-group" id="talk-options-group">
            <label class="form-label">${text('editorExpiration', 'Expiration')}</label>
            <select class="form-input" id="talk-expires" aria-label="Talk expiration">
              <option value="">${text('editorForever', 'Forever')}</option>
              <option value="1y">${text('editorOneYear', 'One year')}</option>
              <option value="1M">${text('editorOneMonth', 'One month')}</option>
              <option value="1w">${text('editorOneWeek', 'One week')}</option>
              <option value="1d">${text('editorOneDay', 'One day')}</option>
            </select>
          </div>
          <div class="form-group" id="talk-location-group">
            <label class="form-label">${text('editorLocation', 'Location')}</label>
            <select class="form-input" id="talk-location-radius" aria-label="Location radius">
              <option value="">${text('editorAnywhere', 'Anywhere')}</option>
              <option value="10">${format('editorMiles', '{count} miles', { count: 10 })}</option>
              <option value="100">${format('editorMiles', '{count} miles', { count: 100 })}</option>
              <option value="1000">${format('editorMiles', '{count} miles', { count: 1000 })}</option>
            </select>
          </div>
          <div class="form-group" id="talk-send-chatroom-group" style="display: ${isEdit ? 'none' : 'block'};">
            <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="talk-send-to-chatroom" checked aria-label="Send to Chatroom">
              <span>${text('editorSendChatroom', 'Send to Chatroom')}</span>
            </label>
          </div>
          <div class="form-group" id="talk-adult-group">
            <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="talk-is-adult" aria-label="Adult content (18+)" ${existingTalk?.isAdult ? 'checked' : ''}>
              <span>🔞 ${text('editorAdult', 'Adult content (18+) - only delivered to age-verified users')}</span>
            </label>
          </div>
          <div class="form-group" id="talk-attachment-group" style="display: ${isEdit ? 'none' : 'block'};">
            <label class="form-label">${text('editorAttachment', 'Attach media (link shared automatically when someone matches)')}</label>
            <input type="file" class="form-input" id="talk-attachment-input" aria-label="Attach media to share on match">
            <div id="talk-attachment-name" style="margin-top: 6px; font-size: 0.85em; color: var(--text-tertiary);"></div>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-talk-btn" style="background: #ccc; color: #333;">${text('editorCancel', 'Cancel')}</button>
            <button type="submit" class="btn" id="talk-submit-btn">${isEdit ? text('editorSave', 'Save changes') : text('editorCreate', 'Create')}</button>
          </div>
        </form>
      </div>
    `;

    const questionsContainer = document.getElementById('questions-container');
    if (questionsContainer) {
      questionsContainer.innerHTML = '';
      if (existingTalk && Array.isArray(existingTalk.questions) && existingTalk.questions.length > 0) {
        existingTalk.questions.forEach((q: any, qIndex: number) => {
          options.addQuestionToForm(qIndex, questionsContainer);
          const questionItem = questionsContainer.querySelector(`[data-question-index="${qIndex}"]`);
          if (questionItem) {
            const textInput = questionItem.querySelector('.question-text') as HTMLInputElement | null;
            if (textInput) textInput.value = q.text || '';
            if (q.reciprocalTagContext) {
              const reciprocalCheckbox = questionItem.querySelector('.question-reciprocal-tag') as HTMLInputElement | null;
              if (reciprocalCheckbox) reciprocalCheckbox.checked = true;
            }
            // §BB / spec §30.2: rehydrate the builtIn kind selector + its typed value so
            // reopening the editor for a saved builtIn question doesn't silently reset to
            // "ordinary answer choices" (the answer-selection-mode toggle has this same gap
            // pre-existing from §FF — not fixed here, out of scope for this change).
            if (q.builtIn?.kind) {
              const kindSelect = questionItem.querySelector('.builtin-kind') as HTMLSelectElement | null;
              if (kindSelect) kindSelect.value = q.builtIn.kind;
              options.applyBuiltInKindToQuestion(questionItem as HTMLElement, q.builtIn.kind);
              if (q.builtIn.kind === 'quantity' && typeof q.builtIn.quantity === 'number') {
                const input = questionItem.querySelector('.builtin-quantity-input') as HTMLInputElement | null;
                if (input) input.value = String(q.builtIn.quantity);
              } else if (q.builtIn.kind === 'priceRange' && q.builtIn.priceRange) {
                const minInput = questionItem.querySelector('.builtin-pricerange-min') as HTMLInputElement | null;
                const maxInput = questionItem.querySelector('.builtin-pricerange-max') as HTMLInputElement | null;
                if (minInput) minInput.value = String(q.builtIn.priceRange.min);
                if (maxInput) maxInput.value = String(q.builtIn.priceRange.max);
              } else if (q.builtIn.kind === 'timeFrame' && q.builtIn.timeFrame) {
                const startInput = questionItem.querySelector('.builtin-timeframe-start') as HTMLInputElement | null;
                const endInput = questionItem.querySelector('.builtin-timeframe-end') as HTMLInputElement | null;
                if (startInput) startInput.value = new Date(q.builtIn.timeFrame.start).toISOString().slice(0, 10);
                if (endInput) endInput.value = new Date(q.builtIn.timeFrame.end).toISOString().slice(0, 10);
              }
            }
            const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement | null;
            if (answersContainer && Array.isArray(q.answers)) {
              answersContainer.innerHTML = '';
              q.answers.forEach((a: any, aIndex: number) => {
                options.addAnswerToQuestion(answersContainer, aIndex);
                const answerItem = answersContainer.querySelector(`[data-answer-index="${aIndex}"]`);
                if (answerItem) {
                  const answerInput = answerItem.querySelector('.answer-text') as HTMLInputElement | null;
                  if (answerInput) answerInput.value = a.text || '';
                }
              });
              options.appendIgnoreRow(answersContainer, qIndex);
            }
          }
        });
        options.updateAllAnswerDropdowns();
        existingTalk.questions.forEach((q: any, qIndex: number) => {
          const questionItem = questionsContainer.querySelector(`[data-question-index="${qIndex}"]`);
          if (!questionItem || !Array.isArray(q.answers)) return;
          const answersContainer = questionItem.querySelector('.answers-container');
          if (!answersContainer) return;
          const answerItems = answersContainer.querySelectorAll('.answer-item');
          q.answers.forEach((a: any, aIndex: number) => {
            const answerItem = answerItems[aIndex];
            const nextSelect = answerItem?.querySelector('.answer-next') as HTMLSelectElement | null;
            if (!nextSelect) return;
            if (a.isIgnore) nextSelect.value = 'ignore';
            else if (a.isMatch) nextSelect.value = 'noticed';
            else if (a.nextQuestionId) nextSelect.value = a.nextQuestionId;
          });
        });
        const editingId = existingTalk.id;
        if (editingId) {
          const prefs = options.getAnswerPreferences();
          existingTalk.questions.forEach((q: any, qIndex: number) => {
            const questionId = q.id || `q_${qIndex}`;
            const key = `${editingId}_${questionId}`;
            const pref = prefs[key];
            const questionItem = questionsContainer.querySelector(`[data-question-index="${qIndex}"]`);
            const radio = questionItem?.querySelector(`input[name="self-answer-q_${qIndex}"][value="${pref?.answerId}"]`) as HTMLInputElement | null;
            if (radio) {
              radio.checked = true;
            } else {
              const ignoreRadio = questionItem?.querySelector('.self-answer-ignore-row input[value="ignore"]') as HTMLInputElement | null;
              if (ignoreRadio) ignoreRadio.checked = true;
            }
          });
        }
      } else {
        options.addQuestionToForm(0, questionsContainer);
      }
    }

    const expiresSelect = document.getElementById('talk-expires') as HTMLSelectElement | null;
    const locationSelect = document.getElementById('talk-location-radius') as HTMLSelectElement | null;
    if (existingTalk) {
      if (expiresSelect && existingTalk.expiresAt != null) {
        const exp = Number(existingTalk.expiresAt);
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        if (now > exp) expiresSelect.value = '';
        else if (exp - now <= oneDay) expiresSelect.value = '1d';
        else if (exp - now <= 7 * oneDay) expiresSelect.value = '1w';
        else if (exp - now <= 30 * oneDay) expiresSelect.value = '1M';
        else if (exp - now <= 365 * oneDay) expiresSelect.value = '1y';
        else expiresSelect.value = '';
      }
      if (locationSelect && existingTalk.locationRadiusMiles != null) {
        locationSelect.value = String(existingTalk.locationRadiusMiles);
      }
    }

    const talkOptionsGroup = document.getElementById('talk-options-group');
    const talkLocationGroup = document.getElementById('talk-location-group');
    const talkSendChatroomGroup = document.getElementById('talk-send-chatroom-group');
    const talkTagGroup = document.getElementById('talk-tag-group');
    const tagLikeGroup = document.getElementById('tag-like-group');
    const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
    const tagAnswerGroup = document.getElementById('tag-answer-group');
    const talkTypeSelect = document.getElementById('talk-type') as HTMLSelectElement | null;
    const questionsFormGroup = document.getElementById('questions-form-group');
    const routeFormGroup = document.getElementById('route-form-group');
    const questionsTypeHint = document.getElementById('talk-editor-type-hint');
    const questionsFormLabel = document.getElementById('questions-form-label');

    const updateFormForType = (): void => {
      const type = talkTypeSelect?.value || 'tag';
      const titleInput = document.getElementById('talk-title') as HTMLInputElement | null;
      const desc = document.querySelector('.talk-editor-description');
      if (questionsFormGroup) questionsFormGroup.style.display = 'none';
      if (routeFormGroup) routeFormGroup.style.display = 'none';
      if (tagLikeGroup) tagLikeGroup.style.display = 'none';
      if (tagAnswerGroup) tagAnswerGroup.style.display = 'none';
      if (talkOptionsGroup) talkOptionsGroup.style.display = 'none';
      if (talkLocationGroup) talkLocationGroup.style.display = 'none';
      if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = 'none';
      if (talkTagGroup) talkTagGroup.style.display = 'block';
      if (questionsFormGroup) {
        questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
          (el as HTMLInputElement).disabled = true;
        });
      }

      if (type === 'tag') {
        if (tagLikeGroup) tagLikeGroup.style.display = 'block';
        if (tagLikeCheckbox && !isEdit && tagLikeCheckbox.checked === false) tagLikeCheckbox.checked = true;
        // docs/TODO.md §LL: a tag IS a single-question talk — `#talk-tag`/`#talk-preference-set`
        // (the flow/route selfTag+counterpart picker below) is a different field pair for a
        // different concept and would just be visual clutter here; the tag's own keyword lives
        // in the title field, and its accepted answer lives in `#talk-answer` instead.
        if (talkTagGroup) talkTagGroup.style.display = 'none';
        if (tagAnswerGroup) tagAnswerGroup.style.display = 'block';
        if (titleInput) {
          titleInput.placeholder = text('editorTagPlaceholder', 'e.g., Coffee, Tennis, Jobs');
          titleInput.setAttribute('aria-label', text('editorTagKeyword', 'Tag keyword'));
        }
        if (desc) (desc as HTMLElement).textContent = text('editorTagDescription', 'Tag: one keyword. Others answer with a checkbox - checked = match, unchecked = ignore.');
        return;
      }

      if (talkOptionsGroup) talkOptionsGroup.style.display = 'block';
      if (talkLocationGroup) talkLocationGroup.style.display = 'block';
      if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = isEdit ? 'none' : 'block';
      if (titleInput) {
        titleInput.placeholder = text('editorTitlePlaceholder', 'e.g., Coffee Meetup, Quick Survey');
        titleInput.removeAttribute('aria-label');
      }

      if (type === 'route') {
        if (routeFormGroup) routeFormGroup.style.display = 'block';
        if (desc) (desc as HTMLElement).textContent = text('editorRouteDescription', 'Route: a branching DAG. Each answer can lead to a follow-up question; the same question can appear in different branches with different context ids.');
        options.ensureRouteEditorRendered(existingTalk);
        return;
      }

      if (questionsFormGroup) {
        questionsFormGroup.style.display = 'block';
        questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
          (el as HTMLInputElement).disabled = false;
        });
      }
      if (type === 'survey') {
        // Surveys never have a match/ignore outcome (checkIfMatch always returns false for
        // them) — a self-tag/preference-set picker would be meaningless here.
        if (talkTagGroup) talkTagGroup.style.display = 'none';
        if (questionsFormLabel) questionsFormLabel.textContent = text('editorSurveyQuestions', 'Questions (independent)');
        if (questionsTypeHint) {
          questionsTypeHint.textContent = text('editorSurveyHint', 'Survey: questions are independent - no branching. Every answer has a counter used for aggregate statistics.');
        }
        if (desc) (desc as HTMLElement).textContent = text('editorSurveyDescription', 'Survey: independent question and answer pairs. Counts per answer are tallied for statistics.');
      } else {
        if (questionsFormLabel) questionsFormLabel.textContent = text('editorFlowQuestions', 'Questions (flow)');
        if (questionsTypeHint) {
          questionsTypeHint.textContent = text('editorFlowHint', 'Flow: each question must be unique. The first answer is your match or next-question decision; extra answers are treated as ignore.');
        }
        if (desc) (desc as HTMLElement).textContent = text('editorFlowDescription', 'Flow: a linear chain of unique questions - the first answer decides and the rest are ignored.');
      }
      options.refreshFlowAnswerConstraints(type);
    };

    modal.querySelectorAll('input[name="talk-type-radio"]').forEach((radio) => {
      radio.addEventListener('change', (event) => {
        const value = (event.target as HTMLInputElement).value;
        if (talkTypeSelect) talkTypeSelect.value = value;
        updateFormForType();
      });
    });
    const checkedRadio = modal.querySelector('input[name="talk-type-radio"]:checked') as HTMLInputElement | null;
    if (talkTypeSelect && checkedRadio) {
      talkTypeSelect.value = checkedRadio.value;
    }
    if (talkTypeSelect) {
      talkTypeSelect.addEventListener('change', updateFormForType);
      updateFormForType();
    }

    // Spec §30.2 Phase 5 / docs/TODO.md §LL: `#talk-tag`'s value doubles as this talk's
    // `selfTag` (a plain self-declaration — "buy", "sell", ...), replacing the old separate
    // role picker; `#talk-preference-set` is the explicit, editable accepted-answer field
    // (the underlying `preferenceSet: string[]` field always holds exactly one entry now — see
    // §LL's single-answer rule). §LL reframed `type: 'tag'` talks the same way: the tag word
    // (from `#talk-title`) is the question, `#talk-answer` is the answer. Both pairs share
    // identical auto-fill/lock/preview behavior — seeded opposite (buy → sell) if known, else
    // the SAME word (self-match, "Tennis" matches "Tennis") — wired once via
    // `wireTagAnswerAutoFill` below rather than duplicated per field.
    const tagRegistry = createSeededTagOppositePairRegistryState();
    const preferenceSetAlreadyLocked = !!(existingTalk?.preferenceSet && existingTalk.preferenceSet.length > 0);

    const talkTagInput = document.getElementById('talk-tag') as HTMLInputElement | null;
    wireTagAnswerAutoFill({
      sourceInput: talkTagInput,
      answerInput: document.getElementById('talk-preference-set') as HTMLInputElement | null,
      previewEl: document.getElementById('talk-tag-preview'),
      registry: tagRegistry,
      initiallyLocked: preferenceSetAlreadyLocked,
      selfMatchPreviewText: (tag) => format('editorTagPairNoOpposite', "Matches anyone also tagged '{tag}'.", { tag }),
      oppositePreviewText: (answer) => `${text('editorTagPairOppositeLabel', 'Shown to people tagged:')} ${answer}`,
    });

    // Auto-suggest the first question's wording from `#talk-tag` — a separate concern from the
    // answer auto-fill above (only meaningful for flow/route, which have a real first question),
    // only when the author hasn't typed anything there yet, so this never clobbers a real edit.
    talkTagInput?.addEventListener('input', () => {
      const tagValue = talkTagInput.value.trim();
      if (!tagValue) return;
      const titleInput = document.getElementById('talk-title') as HTMLInputElement | null;
      const template = questionTemplateForTag(tagValue, titleInput?.value || '');
      if (template) {
        const flowQ1Text = document.querySelector('.question-item[data-question-index="0"] .question-text') as HTMLInputElement | null;
        if (flowQ1Text && !flowQ1Text.value.trim()) flowQ1Text.value = template;
        const routeQ1Text = document.querySelector('.route-question-text[data-qid="q_0"]') as HTMLInputElement | null;
        if (routeQ1Text && !routeQ1Text.value.trim()) routeQ1Text.value = template;
      }
    });

    wireTagAnswerAutoFill({
      sourceInput: document.getElementById('talk-title') as HTMLInputElement | null,
      answerInput: document.getElementById('talk-answer') as HTMLInputElement | null,
      previewEl: document.getElementById('talk-answer-preview'),
      registry: tagRegistry,
      initiallyLocked: preferenceSetAlreadyLocked,
      selfMatchPreviewText: (tag) => format('editorTagPairNoOpposite', "Matches anyone also tagged '{tag}'.", { tag }),
      oppositePreviewText: (answer) => `${text('editorTagPairOppositeLabel', 'Shown to people tagged:')} ${answer}`,
    });

    options.setupTalkFormHandlers(modal);
  };

  document.body.appendChild(modal);
  renderForm();
}
