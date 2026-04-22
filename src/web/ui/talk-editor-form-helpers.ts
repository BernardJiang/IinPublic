type TalkEditorFormHelperOptions = {
  refreshFlowAnswerConstraints: (type: string) => void;
  processTalkForm: (form: HTMLFormElement) => boolean;
};

function renumberSelfAnswerRadios(answersContainer: HTMLElement): void {
  const questionItem = answersContainer.closest('.question-item');
  if (!questionItem) return;
  const qIndex = parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10);
  const name = `self-answer-q_${qIndex}`;
  answersContainer.querySelectorAll('.answer-item').forEach((answerItem, aIdx) => {
    const radio = answerItem.querySelector('.self-answer-radio') as HTMLInputElement | null;
    if (radio) {
      radio.name = name;
      radio.value = `a_${qIndex}_${aIdx}`;
    }
  });
  const ignoreRow = answersContainer.querySelector('.self-answer-ignore-row');
  if (ignoreRow) {
    const ignoreRadio = ignoreRow.querySelector('input[type="radio"]') as HTMLInputElement | null;
    if (ignoreRadio) ignoreRadio.name = name;
  }
}

function renumberAnswers(container: HTMLElement): void {
  const answers = container.querySelectorAll('.answer-item');
  answers.forEach((a, idx) => {
    a.setAttribute('data-answer-index', idx.toString());
    const input = a.querySelector('.answer-text') as HTMLInputElement | null;
    if (input && !input.value) {
      input.placeholder = `Answer ${idx + 1}`;
    }
  });
}

function renumberQuestions(): void {
  const questions = document.querySelectorAll('.question-item');
  questions.forEach((q, idx) => {
    q.setAttribute('data-question-index', idx.toString());
    const header = q.querySelector('strong');
    if (header) {
      header.textContent = `Question ${idx + 1}`;
    }
    const answersContainer = q.querySelector('.answers-container') as HTMLElement | null;
    if (answersContainer) {
      renumberSelfAnswerRadios(answersContainer);
      const ignoreRow = answersContainer.querySelector('.self-answer-ignore-row input[type="radio"]') as HTMLInputElement | null;
      if (ignoreRow) ignoreRow.name = `self-answer-q_${idx}`;
    }
  });
}

export function appendIgnoreRow(container: HTMLElement, qIndex: number): void {
  if (container.querySelector('.self-answer-ignore-row')) return;
  const row = document.createElement('div');
  row.className = 'self-answer-ignore-row';
  row.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-top: 6px; margin-bottom: 8px;';
  row.innerHTML = `
    <input type="radio" name="self-answer-q_${qIndex}" value="ignore" class="self-answer-radio" checked title="My answer">
    <span style="font-size: 0.9em; color: #666;">Ignore</span>
  `;
  container.appendChild(row);
}

export function addAnswerToQuestion(container: HTMLElement, index: number, options: TalkEditorFormHelperOptions): void {
  const questionItem = container.closest('.question-item');
  const qIdx = questionItem ? parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10) : 0;
  const answerDiv = document.createElement('div');
  answerDiv.className = 'answer-item';
  answerDiv.dataset.answerIndex = index.toString();
  answerDiv.style.cssText = `
    display: flex;
    gap: 10px;
    align-items: center;
    margin-bottom: 8px;
  `;
  const radioName = `self-answer-q_${qIdx}`;
  const radioValue = `a_${qIdx}_${index}`;
  answerDiv.innerHTML = `
    <input type="radio" name="${radioName}" value="${radioValue}" class="self-answer-radio" title="My answer">
    <input
      type="text"
      class="form-input answer-text"
      placeholder="Answer ${index + 1}"
      required
      style="flex: 1;"
    >
    <span style="font-size: 0.9em; color: #666;">→</span>
    <select class="form-input answer-next" style="flex: 0 0 180px; font-size: 0.9em;">
      <option value="ignore">Ignore (filter out)</option>
      <option value="noticed">Noticed (match)</option>
    </select>
    ${index > 1 ? '<button type="button" class="btn-remove-answer" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">×</button>' : ''}
  `;

  const ignoreRow = container.querySelector('.self-answer-ignore-row');
  if (ignoreRow) {
    container.insertBefore(answerDiv, ignoreRow);
  } else {
    container.appendChild(answerDiv);
  }

  const nextSelect = answerDiv.querySelector('.answer-next') as HTMLSelectElement | null;
  nextSelect?.addEventListener('change', () => {
    const val = nextSelect.value;
    if (val && val !== 'ignore' && (val === 'noticed' || val.startsWith('q_'))) {
      const radio = answerDiv.querySelector(`input[name="${radioName}"]`) as HTMLInputElement | null;
      if (radio) radio.checked = true;
    }
  });

  const removeBtn = answerDiv.querySelector('.btn-remove-answer');
  removeBtn?.addEventListener('click', () => {
    container.removeChild(answerDiv);
    renumberAnswers(container);
    updateAllAnswerDropdowns(options);
    renumberSelfAnswerRadios(container);
  });
}

export function addQuestionToForm(index: number, container: HTMLElement, options: TalkEditorFormHelperOptions): void {
  const questionDiv = document.createElement('div');
  questionDiv.className = 'question-item';
  questionDiv.dataset.questionIndex = index.toString();
  questionDiv.style.cssText = `
    background: #f9f9f9;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 15px;
  `;

  questionDiv.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <strong style="color: #667eea;">Question ${index + 1}</strong>
      ${index > 0 ? '<button type="button" class="btn-remove-question" style="background: #f44336; color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">Remove</button>' : ''}
    </div>
    <input
      type="text"
      class="form-input question-text"
      placeholder="Enter your question here (e.g., Do you like coffee?)"
      required
      style="margin-bottom: 10px;"
    >
    <div class="answers-container" style="margin-left: 15px;"></div>
    <button type="button" class="btn-add-answer" style="margin-top: 8px; font-size: 0.9em; background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">+ Add Answer</button>
  `;

  container.appendChild(questionDiv);

  const answersContainer = questionDiv.querySelector('.answers-container') as HTMLElement;
  addAnswerToQuestion(answersContainer, 0, options);
  addAnswerToQuestion(answersContainer, 1, options);
  appendIgnoreRow(answersContainer, index);

  const removeBtn = questionDiv.querySelector('.btn-remove-question');
  removeBtn?.addEventListener('click', () => {
    container.removeChild(questionDiv);
    renumberQuestions();
    updateAllAnswerDropdowns(options);
  });

  const addAnswerBtn = questionDiv.querySelector('.btn-add-answer');
  addAnswerBtn?.addEventListener('click', () => {
    const answerCount = answersContainer.querySelectorAll('.answer-item').length;
    addAnswerToQuestion(answersContainer, answerCount, options);
    updateAllAnswerDropdowns(options);
  });
}

export function updateAllAnswerDropdowns(options: TalkEditorFormHelperOptions): void {
  const questions = document.querySelectorAll('.question-item');

  questions.forEach((questionItem, qIdx) => {
    const answersContainer = questionItem.querySelector('.answers-container');
    if (!answersContainer) return;

    const answerSelects = answersContainer.querySelectorAll('.answer-next');
    answerSelects.forEach((select) => {
      const currentValue = (select as HTMLSelectElement).value;
      const dropdownOptions = [
        '<option value="ignore">Ignore (filter out)</option>',
        '<option value="noticed">Noticed (match)</option>',
      ];

      for (let i = qIdx + 1; i < questions.length; i++) {
        dropdownOptions.push(`<option value="q_${i}">Go to Question ${i + 1}</option>`);
      }

      select.innerHTML = dropdownOptions.join('');

      if (currentValue && currentValue !== '') {
        const optionExists = Array.from(select.children).some(
          (opt) => (opt as HTMLOptionElement).value === currentValue,
        );
        if (optionExists) {
          (select as HTMLSelectElement).value = currentValue;
        }
      }
    });
  });

  const talkTypeSelect = document.getElementById('talk-type') as HTMLSelectElement | null;
  if (talkTypeSelect) {
    options.refreshFlowAnswerConstraints(talkTypeSelect.value || 'flow');
  }
}

export function setupTalkFormHandlers(modal: HTMLElement, options: TalkEditorFormHelperOptions): void {
  const form = document.getElementById('talk-editor-form') as HTMLFormElement | null;
  const cancelBtn = document.getElementById('cancel-talk-btn');
  const addQuestionBtn = document.getElementById('add-question-btn');
  const questionsContainer = document.getElementById('questions-container');

  cancelBtn?.addEventListener('click', () => {
    if (document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  });

  addQuestionBtn?.addEventListener('click', () => {
    const questionCount = questionsContainer?.children.length || 0;
    if (!questionsContainer) return;
    addQuestionToForm(questionCount, questionsContainer, options);
    updateAllAnswerDropdowns(options);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const ok = options.processTalkForm(form);
    if (ok && document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  });
}
