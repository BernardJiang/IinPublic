import type { UiTranslationKey } from './ui-translations';

type TalkEditorDialogOptions = {
  existingTalk?: any;
  escapeHtml: (text: string) => string;
  getAnswerPreferences: () => Record<string, any>;
  addQuestionToForm: (index: number, container: HTMLElement) => void;
  addAnswerToQuestion: (container: HTMLElement, index: number) => void;
  appendIgnoreRow: (container: HTMLElement, qIndex: number) => void;
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
  if (existingTalk?.id) {
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
        <form id="talk-editor-form" style="padding: 20px;" data-editing-talk-id="${existingTalk?.id || ''}">
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
    const tagLikeGroup = document.getElementById('tag-like-group');
    const tagLikeCheckbox = document.getElementById('tag-like-checkbox') as HTMLInputElement | null;
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
      if (talkOptionsGroup) talkOptionsGroup.style.display = 'none';
      if (talkLocationGroup) talkLocationGroup.style.display = 'none';
      if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = 'none';
      if (questionsFormGroup) {
        questionsFormGroup.querySelectorAll('input, select, textarea').forEach((el) => {
          (el as HTMLInputElement).disabled = true;
        });
      }

      if (type === 'tag') {
        if (tagLikeGroup) tagLikeGroup.style.display = 'block';
        if (tagLikeCheckbox && !isEdit && tagLikeCheckbox.checked === false) tagLikeCheckbox.checked = true;
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

    options.setupTalkFormHandlers(modal);
  };

  document.body.appendChild(modal);
  renderForm();
}
