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
};

export function showTalkEditorDialog(options: TalkEditorDialogOptions): void {
  const { existingTalk } = options;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'talk-editor-modal';
  if (existingTalk?.id) {
    (modal as HTMLElement).dataset.editingTalkId = existingTalk.id;
  }

  const renderForm = (): void => {
    const isEdit = !!(existingTalk && existingTalk.id);
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 1000px; max-height: 90vh; overflow-y: auto;">
        <div class="modal-header">
          <h2 class="modal-title">${isEdit ? 'Edit Talk' : 'Create a Talk'}</h2>
          <p class="talk-editor-description">Build a branching conversation flow - each answer can lead to a different question</p>
        </div>
        <form id="talk-editor-form" style="padding: 20px;" data-editing-talk-id="${existingTalk?.id || ''}">
          <div class="form-group">
            <label class="form-label">Talk Title</label>
            <input type="text" class="form-input" id="talk-title" placeholder="e.g., Coffee Meetup, Quick Survey" required value="${existingTalk ? options.escapeHtml(existingTalk.title) : ''}">
          </div>

          <div class="form-group" id="tag-like-group" style="display: none;">
            <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="tag-like-checkbox" checked aria-label="I like this tag">
              <span>I like this tag</span>
            </label>
          </div>

          <div class="form-group">
            <label class="form-label">Type</label>
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="tag" ${existingTalk?.type === 'tag' || !existingTalk ? 'checked' : ''}>
                <span>Tag (single keyword; answer with one checkbox — match or ignore)</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="flow" ${existingTalk?.type === 'flow' ? 'checked' : ''}>
                <span>Flow – sequential questions that find compatible people</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="survey" ${existingTalk?.type === 'survey' ? 'checked' : ''}>
                <span>Survey – independent questions that collect aggregate counts</span>
              </label>
              <label class="talk-type-option" style="display: flex; align-items: center; gap: 10px; cursor: pointer; padding: 8px 0;">
                <input type="radio" name="talk-type-radio" value="route" ${existingTalk?.type === 'route' ? 'checked' : ''}>
                <span>Route – branching DAG of questions (tree editor)</span>
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
            <label class="form-label" id="questions-form-label">Questions &amp; Branching</label>
            <p class="talk-editor-type-hint" id="talk-editor-type-hint" style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;"></p>
            <div id="questions-container"></div>
            <button type="button" id="add-question-btn" class="btn" style="margin-top: 10px; background: #667eea; color: white;">+ Add Question</button>
          </div>

          <div class="form-group" id="route-form-group" style="display: none;">
            <label class="form-label">Route (DAG editor)</label>
            <p style="margin: 0 0 10px 0; font-size: 0.9em; color: #666;">
              Build a branching tree. Each answer can lead to a follow-up question. On any
              path from the root to a leaf, the same question cannot appear twice — but the
              same question may appear in two different branches (each will have its own
              context hash ID).
            </p>
            <div id="route-editor"></div>
            <div id="talk-validation-errors" class="talk-validation-errors" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid #f44336; background: #fdecea; color: #b71c1c; border-radius: 6px; font-size: 0.9em;"></div>
          </div>

          <div class="form-group" id="talk-validation-group" style="display: none;">
            <div id="talk-autofix-banner" class="talk-autofix-banner" style="display: none; margin-top: 10px; padding: 10px; border: 1px solid #4CAF50; background: #e8f5e9; color: #1b5e20; border-radius: 6px; font-size: 0.9em;"></div>
          </div>

          <div class="form-group" id="talk-options-group">
            <label class="form-label">Expiration</label>
            <select class="form-input" id="talk-expires" aria-label="Talk expiration">
              <option value="">Forever</option>
              <option value="1y">One year</option>
              <option value="1M">One month</option>
              <option value="1w">One week</option>
              <option value="1d">One day</option>
            </select>
          </div>
          <div class="form-group" id="talk-location-group">
            <label class="form-label">Location</label>
            <select class="form-input" id="talk-location-radius" aria-label="Location radius">
              <option value="">Anywhere</option>
              <option value="10">10 miles</option>
              <option value="100">100 miles</option>
              <option value="1000">1000 miles</option>
            </select>
          </div>
          <div class="form-group" id="talk-send-chatroom-group" style="display: ${isEdit ? 'none' : 'block'};">
            <label class="talk-send-chatroom-label" style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input type="checkbox" id="talk-send-to-chatroom" checked aria-label="Send to Chatroom">
              <span>Send to Chatroom</span>
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn" id="cancel-talk-btn" style="background: #ccc; color: #333;">Cancel</button>
            <button type="submit" class="btn" id="talk-submit-btn">${isEdit ? 'Save changes' : 'Create'}</button>
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
          titleInput.placeholder = 'e.g., Coffee, Tennis, Jobs';
          titleInput.setAttribute('aria-label', 'Tag keyword');
        }
        if (desc) (desc as HTMLElement).textContent = 'Tag: one keyword. Others answer with a checkbox — checked = match, unchecked = ignore.';
        return;
      }

      if (talkOptionsGroup) talkOptionsGroup.style.display = 'block';
      if (talkLocationGroup) talkLocationGroup.style.display = 'block';
      if (talkSendChatroomGroup) talkSendChatroomGroup.style.display = isEdit ? 'none' : 'block';
      if (titleInput) {
        titleInput.placeholder = 'e.g., Coffee Meetup, Quick Survey';
        titleInput.removeAttribute('aria-label');
      }

      if (type === 'route') {
        if (routeFormGroup) routeFormGroup.style.display = 'block';
        if (desc) (desc as HTMLElement).textContent = 'Route: a branching DAG. Each answer can lead to a follow-up question — same question can appear in different branches (different context hash ID).';
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
        if (questionsFormLabel) questionsFormLabel.textContent = 'Questions (independent)';
        if (questionsTypeHint) {
          questionsTypeHint.textContent =
            'Survey: questions are independent — no branching. Every answer has a counter used for aggregate statistics.';
        }
        if (desc) (desc as HTMLElement).textContent = 'Survey: independent Q/A pairs. Counts per answer are tallied for statistics.';
      } else {
        if (questionsFormLabel) questionsFormLabel.textContent = 'Questions (flow)';
        if (questionsTypeHint) {
          questionsTypeHint.textContent =
            'Flow: each question must be unique. The first answer is your "match" or "go to next" decision; any extra answers are treated as ignore.';
        }
        if (desc) (desc as HTMLElement).textContent = 'Flow: a linear chain of unique questions — first answer decides, rest are ignore.';
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
