import type { UiTranslationKey } from './ui-translations';

type TalkEditorFormHelperOptions = {
  refreshFlowAnswerConstraints: (type: string) => void;
  processTalkForm: (form: HTMLFormElement) => boolean;
  text?: (key: UiTranslationKey) => string;
};

function text(options: TalkEditorFormHelperOptions, key: UiTranslationKey, fallback: string): string {
  return options.text?.(key) || fallback;
}

function format(
  options: TalkEditorFormHelperOptions,
  key: UiTranslationKey,
  fallback: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (label, [placeholder, value]) => label.replace(`{${placeholder}}`, String(value)),
    text(options, key, fallback),
  );
}

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

function renumberAnswers(container: HTMLElement, options: TalkEditorFormHelperOptions): void {
  const answers = container.querySelectorAll('.answer-item');
  answers.forEach((a, idx) => {
    a.setAttribute('data-answer-index', idx.toString());
    const input = a.querySelector('.answer-text') as HTMLInputElement | null;
    if (input && !input.value) {
      input.placeholder = format(options, 'editorAnswerPlaceholder', 'Answer {count}', { count: idx + 1 });
    }
  });
}

function renumberQuestions(options: TalkEditorFormHelperOptions): void {
  const questions = document.querySelectorAll('.question-item');
  questions.forEach((q, idx) => {
    q.setAttribute('data-question-index', idx.toString());
    const header = q.querySelector('strong');
    if (header) {
      header.textContent = format(options, 'editorQuestionNumber', 'Question {count}', { count: idx + 1 });
    }
    const answersContainer = q.querySelector('.answers-container') as HTMLElement | null;
    if (answersContainer) {
      renumberSelfAnswerRadios(answersContainer);
      const ignoreRow = answersContainer.querySelector('.self-answer-ignore-row input[type="radio"]') as HTMLInputElement | null;
      if (ignoreRow) ignoreRow.name = `self-answer-q_${idx}`;
    }
  });
}

export function appendIgnoreRow(container: HTMLElement, qIndex: number, options?: TalkEditorFormHelperOptions): void {
  if (container.querySelector('.self-answer-ignore-row')) return;
  const row = document.createElement('div');
  row.className = 'self-answer-ignore-row';
  row.style.cssText = 'display: flex; align-items: center; gap: 10px; margin-top: 6px; margin-bottom: 8px;';
  row.innerHTML = `
    <input type="radio" name="self-answer-q_${qIndex}" value="ignore" class="self-answer-radio" checked title="${options ? text(options, 'editorMyAnswer', 'My answer') : 'My answer'}">
    <span style="font-size: 0.9em; color: var(--text-secondary);">${options ? text(options, 'editorIgnore', 'Ignore') : 'Ignore'}</span>
  `;
  container.appendChild(row);
}

/** Spec §3.4 FR-QA-15 / §30.8: 'single' (default, radio) or 'multiple' (checkbox) — read from
 *  the question's own mode-select, defaulting to 'single' if the control isn't present yet. */
function questionAnswerSelectionMode(questionItem: Element | null): 'single' | 'multiple' {
  const select = questionItem?.querySelector('.answer-selection-mode') as HTMLSelectElement | null;
  return select?.value === 'multiple' ? 'multiple' : 'single';
}

export function addAnswerToQuestion(container: HTMLElement, index: number, options: TalkEditorFormHelperOptions): void {
  const questionItem = container.closest('.question-item');
  const qIdx = questionItem ? parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10) : 0;
  const mode = questionAnswerSelectionMode(questionItem);
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
  const selfAnswerInputType = mode === 'multiple' ? 'checkbox' : 'radio';
  answerDiv.innerHTML = `
    <input type="${selfAnswerInputType}" name="${radioName}" value="${radioValue}" class="self-answer-radio" title="${text(options, 'editorMyAnswer', 'My answer')}">
    <input
      type="text"
      class="form-input answer-text"
      placeholder="${format(options, 'editorAnswerPlaceholder', 'Answer {count}', { count: index + 1 })}"
      required
      style="flex: 1;"
    >
    <span style="font-size: 0.9em; color: var(--text-secondary);">→</span>
    <select class="form-input answer-next" style="flex: 0 0 180px; font-size: 0.9em;">
      <option value="ignore">${text(options, 'editorIgnoreFilter', 'Ignore (filter out)')}</option>
      <option value="noticed">${text(options, 'editorNoticed', 'Noticed (match)')}</option>
    </select>
    ${index > 1 ? '<button type="button" class="btn-remove-answer" style="background: var(--danger); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">×</button>' : ''}
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
    renumberAnswers(container, options);
    updateAllAnswerDropdowns(options);
    renumberSelfAnswerRadios(container);
  });
}

export function addQuestionToForm(index: number, container: HTMLElement, options: TalkEditorFormHelperOptions): void {
  const questionDiv = document.createElement('div');
  questionDiv.className = 'question-item';
  questionDiv.dataset.questionIndex = index.toString();
  questionDiv.style.cssText = `
    background: var(--bg-subtle);
    border: 2px solid var(--border);
    border-radius: 8px;
    padding: 15px;
    margin-bottom: 15px;
  `;

  questionDiv.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
      <strong style="color: var(--accent);">${format(options, 'editorQuestionNumber', 'Question {count}', { count: index + 1 })}</strong>
      ${index > 0 ? `<button type="button" class="btn-remove-question" style="background: var(--danger); color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8em;">${text(options, 'editorRemove', 'Remove')}</button>` : ''}
    </div>
    <input
      type="text"
      class="form-input question-text"
      placeholder="${text(options, 'editorQuestionPlaceholder', 'Enter your question here (e.g., Do you like coffee?)')}"
      required
      style="margin-bottom: 10px;"
    >
    <details class="question-advanced" style="margin-bottom: 10px;">
      <summary style="cursor: pointer; font-size: 0.88em; color: var(--text-secondary); user-select: none;">${text(options, 'editorAdvancedToggle', 'Advanced options')}</summary>
      <div style="margin-top: 8px;">
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.88em; color: var(--text-secondary);">
          ${text(options, 'editorAnswerSelectionModeLabel', 'Respondent may select:')}
          <select class="form-input answer-selection-mode" style="flex: 0 0 auto; width: auto; font-size: 0.95em;">
            <option value="single">${text(options, 'editorAnswerSelectionModeSingle', 'One (multiple choice)')}</option>
            <option value="multiple">${text(options, 'editorAnswerSelectionModeMultiple', 'Any that apply (checkboxes)')}</option>
          </select>
        </label>
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.88em; color: var(--text-secondary);">
          <input type="checkbox" class="question-simple-tag">
          ${text(options, 'editorSimpleTagLabel', 'Simple tag (answer must match the question itself — needs exactly 1 real answer, besides Ignore)')}
        </label>
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.88em; color: var(--text-secondary);">
          <input type="checkbox" class="question-reciprocal-tag">
          ${text(options, 'editorReciprocalTagLabel', 'Pair tag — define buy/sell context here for later questions (needs exactly 1 real answer, besides Ignore)')}
        </label>
        <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.88em; color: var(--text-secondary);">
          ${text(options, 'editorBuiltInKindLabel', 'Compare using:')}
          <select class="form-input builtin-kind" style="flex: 0 0 auto; width: auto; font-size: 0.95em;">
            <option value="">${text(options, 'editorBuiltInKindNone', 'Ordinary answer choices')}</option>
            <option value="quantity">${text(options, 'editorBuiltInKindQuantity', 'Quantity (number comparison)')}</option>
            <option value="priceRange">${text(options, 'editorBuiltInKindPriceRange', 'Price range (overlap)')}</option>
            <option value="timeFrame">${text(options, 'editorBuiltInKindTimeFrame', 'Time frame (date overlap)')}</option>
            <option value="location">${text(options, 'editorBuiltInKindLocation', 'Location (radius match)')}</option>
            <option value="ageRange">${text(options, 'editorBuiltInKindAgeRange', 'Age range (mutual dating match)')}</option>
          </select>
        </label>
        <div class="builtin-inputs" style="display: none; margin-left: 15px; margin-bottom: 10px;">
          <div class="builtin-kind-fields" data-builtin-kind="quantity" style="display: none; margin-bottom: 6px;">
            <label style="font-size: 0.9em;">${text(options, 'editorBuiltInQuantityLabel', 'Quantity:')}
              <input type="number" class="form-input builtin-quantity-input" style="width: 120px; display: inline-block;">
            </label>
          </div>
          <div class="builtin-kind-fields" data-builtin-kind="priceRange" style="display: none; margin-bottom: 6px;">
            <label style="font-size: 0.9em;">${text(options, 'editorBuiltInPriceMinLabel', 'Min price:')}
              <input type="number" class="form-input builtin-pricerange-min" style="width: 100px; display: inline-block;">
            </label>
            <label style="font-size: 0.9em; margin-left: 12px;">${text(options, 'editorBuiltInPriceMaxLabel', 'Max price:')}
              <input type="number" class="form-input builtin-pricerange-max" style="width: 100px; display: inline-block;">
            </label>
          </div>
          <div class="builtin-kind-fields" data-builtin-kind="timeFrame" style="display: none; margin-bottom: 6px;">
            <label style="font-size: 0.9em;">${text(options, 'editorBuiltInTimeStartLabel', 'From:')}
              <input type="date" class="form-input builtin-timeframe-start" style="display: inline-block;">
            </label>
            <label style="font-size: 0.9em; margin-left: 12px;">${text(options, 'editorBuiltInTimeEndLabel', 'To:')}
              <input type="date" class="form-input builtin-timeframe-end" style="display: inline-block;">
            </label>
          </div>
          <div class="builtin-kind-fields" data-builtin-kind="location" style="display: none; font-size: 0.85em; color: var(--text-secondary);">
            ${text(options, 'editorBuiltInLocationNote', "Uses this talk's own location and radius (set below).")}
          </div>
          <div class="builtin-kind-fields" data-builtin-kind="ageRange" style="display: none; margin-bottom: 6px;">
            <label style="font-size: 0.9em;">${text(options, 'editorBuiltInAgeLabel', 'My age:')}
              <input type="number" class="form-input builtin-agerange-age" style="width: 90px; display: inline-block;">
            </label>
            <label style="font-size: 0.9em; margin-left: 12px;">${text(options, 'editorBuiltInAgeMinLabel', 'Acceptable age, min:')}
              <input type="number" class="form-input builtin-agerange-min" style="width: 90px; display: inline-block;">
            </label>
            <label style="font-size: 0.9em; margin-left: 12px;">${text(options, 'editorBuiltInAgeMaxLabel', 'Acceptable age, max:')}
              <input type="number" class="form-input builtin-agerange-max" style="width: 90px; display: inline-block;">
            </label>
          </div>
        </div>
      </div>
    </details>
    <div class="answers-container" style="margin-left: 15px;"></div>
    <button type="button" class="btn-add-answer" style="margin-top: 8px; font-size: 0.9em; background: var(--success); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer;">${text(options, 'editorAddAnswer', '+ Add Answer')}</button>
  `;

  container.appendChild(questionDiv);

  const answersContainer = questionDiv.querySelector('.answers-container') as HTMLElement;
  addAnswerToQuestion(answersContainer, 0, options);
  addAnswerToQuestion(answersContainer, 1, options);
  appendIgnoreRow(answersContainer, index, options);

  const removeBtn = questionDiv.querySelector('.btn-remove-question');
  removeBtn?.addEventListener('click', () => {
    const form = questionDiv.closest('form');
    container.removeChild(questionDiv);
    renumberQuestions(options);
    updateAllAnswerDropdowns(options);
    if (form) syncAdultLockFromBuiltInKinds(form);
  });

  const addAnswerBtn = questionDiv.querySelector('.btn-add-answer');
  addAnswerBtn?.addEventListener('click', () => {
    const answerCount = answersContainer.querySelectorAll('.answer-item').length;
    addAnswerToQuestion(answersContainer, answerCount, options);
    updateAllAnswerDropdowns(options);
  });

  const modeSelect = questionDiv.querySelector('.answer-selection-mode') as HTMLSelectElement | null;
  modeSelect?.addEventListener('change', () => {
    applyAnswerSelectionModeToQuestion(questionDiv, modeSelect.value === 'multiple' ? 'multiple' : 'single');
    updateAllAnswerDropdowns(options);
  });

  const builtInKindSelect = questionDiv.querySelector('.builtin-kind') as HTMLSelectElement | null;
  builtInKindSelect?.addEventListener('change', () => {
    applyBuiltInKindToQuestion(questionDiv, builtInKindSelect.value);
    const form = questionDiv.closest('form');
    if (form) syncAdultLockFromBuiltInKinds(form);
  });

  // docs/TODO.md §LL follow-up: "Simple tag" (tagKind: 'simple') and "Pair tag"
  // (reciprocalTagContext) are mutually exclusive ways to mark this question as a tag — checking
  // one clears the other.
  const simpleTagCheckbox = questionDiv.querySelector('.question-simple-tag') as HTMLInputElement | null;
  const reciprocalTagCheckbox = questionDiv.querySelector('.question-reciprocal-tag') as HTMLInputElement | null;
  simpleTagCheckbox?.addEventListener('change', () => {
    if (simpleTagCheckbox.checked && reciprocalTagCheckbox) reciprocalTagCheckbox.checked = false;
    applyTagKindVisibilityToQuestion(questionDiv);
  });
  reciprocalTagCheckbox?.addEventListener('change', () => {
    if (reciprocalTagCheckbox.checked && simpleTagCheckbox) simpleTagCheckbox.checked = false;
    applyTagKindVisibilityToQuestion(questionDiv);
  });

  // docs/TODO.md §LL.2 follow-up: while Simple tag is checked, the one visible answer is frozen
  // read-only and mirrors the question text as the author types it (self-match) — the same
  // convenience the route editor's matchAnswerDirty mechanism already gives route questions.
  const questionTextInput = questionDiv.querySelector('.question-text') as HTMLInputElement | null;
  questionTextInput?.addEventListener('input', () => {
    if (!simpleTagCheckbox?.checked) return;
    const firstAnswerText = questionDiv.querySelector('.answer-item[data-answer-index="0"] .answer-text') as HTMLInputElement | null;
    if (firstAnswerText) firstAnswerText.value = questionTextInput.value;
  });
}

/**
 * docs/TODO.md §LL.2 follow-up: a Simple/Pair tag question is structurally fixed to exactly one
 * non-ignore answer (TalkValidator.validateTagKindFields) — hides every answer row beyond the
 * first so the editor doesn't show multi-answer chrome the data model can never actually use.
 * Simple tag additionally freezes that one answer read-only, seeded from the question's own text
 * (self-match); Pair tag leaves it editable since the whole point is a divergent accepted answer.
 * Non-destructive: only visibility/readonly changes, no answer rows or their text are removed, so
 * unchecking either box restores everything exactly as it was.
 */
export function applyTagKindVisibilityToQuestion(questionItem: HTMLElement): void {
  const simpleCheckbox = questionItem.querySelector('.question-simple-tag') as HTMLInputElement | null;
  const reciprocalCheckbox = questionItem.querySelector('.question-reciprocal-tag') as HTMLInputElement | null;
  const isTagKind = !!(simpleCheckbox?.checked || reciprocalCheckbox?.checked);
  questionItem.querySelectorAll<HTMLElement>('.answer-item').forEach((item) => {
    const idx = parseInt(item.getAttribute('data-answer-index') ?? '0', 10);
    item.style.display = isTagKind && idx > 0 ? 'none' : '';
  });
  const addAnswerBtn = questionItem.querySelector('.btn-add-answer') as HTMLElement | null;
  if (addAnswerBtn) addAnswerBtn.style.display = isTagKind ? 'none' : '';
  const firstAnswerText = questionItem.querySelector('.answer-item[data-answer-index="0"] .answer-text') as HTMLInputElement | null;
  if (firstAnswerText) {
    const frozen = !!simpleCheckbox?.checked;
    firstAnswerText.readOnly = frozen;
    firstAnswerText.style.background = frozen ? 'var(--bg-subtle)' : '';
    if (frozen) {
      const questionText = questionItem.querySelector('.question-text') as HTMLInputElement | null;
      if (questionText) firstAnswerText.value = questionText.value;
    }
  }
}

/**
 * Spec §3.4 FR-QA-15 / §30.8: switches every existing answer row's self-answer input (and the
 * ignore row, when present) between radio (single) and checkbox (multiple) in place, without
 * losing already-typed answer text — only the input `type` and `checked` semantics change.
 * 'multiple' mode drops the ignore row entirely: the author's own self-answer is simply
 * "whichever boxes I check" (possibly none), not a special ignore choice — Ignore stays
 * meaningful per-option (the answer-next dropdown, unaffected by this function) but not as a
 * distinct self-answer state.
 */
export function applyAnswerSelectionModeToQuestion(questionItem: HTMLElement, mode: 'single' | 'multiple'): void {
  const inputType = mode === 'multiple' ? 'checkbox' : 'radio';
  questionItem.querySelectorAll<HTMLInputElement>('.self-answer-radio').forEach((input) => {
    if (input.type !== inputType) {
      const wasChecked = input.checked;
      input.type = inputType;
      input.checked = wasChecked;
    }
  });
  const ignoreRow = questionItem.querySelector('.self-answer-ignore-row');
  if (mode === 'multiple' && ignoreRow) {
    ignoreRow.remove();
  } else if (mode === 'single' && !ignoreRow) {
    const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement | null;
    const qIdx = parseInt(questionItem.getAttribute('data-question-index') ?? '0', 10);
    if (answersContainer) appendIgnoreRow(answersContainer, qIdx);
  }
}

/**
 * §DD: force+lock `#talk-is-adult` whenever any question in this form has a `builtIn` kind of
 * `ageRange` — the UI half of the dating-category adult-content lock (`TalkAutofix.fix`,
 * talk-engine.ts, is the authoritative enforcement that can't be bypassed; this is immediate
 * visual feedback + preventing an accidental uncheck). Re-enables the checkbox — without
 * forcing it back off — once no `ageRange` question remains, so it stays ordinarily
 * user-controlled for every other talk. Scoped to whatever root is passed in (the talk-editor
 * `<form>`) rather than `document`, since only one editor is ever open at a time but scoping
 * still keeps this safe to call from a detached/about-to-be-removed question row.
 */
export function syncAdultLockFromBuiltInKinds(root: ParentNode): void {
  const adultCheckbox = root.querySelector('#talk-is-adult') as HTMLInputElement | null;
  if (!adultCheckbox) return;
  const hasAgeRange = Array.from(root.querySelectorAll<HTMLSelectElement>('.builtin-kind')).some(
    (select) => select.value === 'ageRange',
  );
  if (hasAgeRange) {
    adultCheckbox.checked = true;
    adultCheckbox.disabled = true;
  } else if (adultCheckbox.disabled) {
    adultCheckbox.disabled = false;
  }
}

/**
 * §BB / spec §30.2: a `builtIn` (typed comparison) question has no author-typed answers at
 * all — `TalkAutofix.fix` generates its 2 synthetic answers (`Compatible`/`Not compatible`)
 * from `Question.builtIn` alone. Selecting a kind hides the ordinary answers UI (and the now-
 * meaningless answer-selection-mode toggle) and shows the matching typed-input widget instead;
 * clearing the `required` attribute on the hidden `.answer-text` inputs so they never block
 * native form submission while invisible.
 */
export function applyBuiltInKindToQuestion(questionItem: HTMLElement, kind: string): void {
  const isBuiltIn = kind !== '';
  const answersContainer = questionItem.querySelector('.answers-container') as HTMLElement | null;
  const addAnswerBtn = questionItem.querySelector('.btn-add-answer') as HTMLElement | null;
  const modeLabel = questionItem.querySelector('.answer-selection-mode')?.closest('label') as HTMLElement | null;
  const builtinInputs = questionItem.querySelector('.builtin-inputs') as HTMLElement | null;

  if (answersContainer) {
    answersContainer.style.display = isBuiltIn ? 'none' : '';
    answersContainer.querySelectorAll<HTMLInputElement>('.answer-text').forEach((input) => {
      input.required = !isBuiltIn;
    });
  }
  if (addAnswerBtn) addAnswerBtn.style.display = isBuiltIn ? 'none' : '';
  if (modeLabel) modeLabel.style.display = isBuiltIn ? 'none' : '';
  if (builtinInputs) {
    builtinInputs.style.display = isBuiltIn ? '' : 'none';
    builtinInputs.querySelectorAll<HTMLElement>('.builtin-kind-fields').forEach((el) => {
      el.style.display = el.dataset.builtinKind === kind ? '' : 'none';
    });
  }
}

export interface BuiltInReadResult {
  kind: string;
  quantity?: number;
  priceRange?: { min: number; max: number };
  timeFrame?: { start: number; end: number };
  ageRange?: { age: number; acceptableRange: { min: number; max: number } };
  /** Set when `kind` is non-empty but the typed value is missing/invalid — caller should
   *  surface this and abort before autofix/validate, same as any other early-exit field error. */
  error?: string;
}

/** Reads the builtIn kind + typed value directly authored on this question row, if any. */
export function readBuiltInSpecFromQuestion(
  questionItem: Element | null,
  options: TalkEditorFormHelperOptions,
): BuiltInReadResult {
  const select = questionItem?.querySelector('.builtin-kind') as HTMLSelectElement | null;
  const kind = select?.value || '';
  if (!kind) return { kind: '' };

  if (kind === 'quantity') {
    const input = questionItem?.querySelector('.builtin-quantity-input') as HTMLInputElement | null;
    const quantity = Number(input?.value);
    if (!input?.value || !Number.isFinite(quantity)) {
      return { kind, error: text(options, 'editorBuiltInQuantityRequired', 'Enter a quantity for the built-in comparison question.') };
    }
    return { kind, quantity };
  }

  if (kind === 'priceRange') {
    const minInput = questionItem?.querySelector('.builtin-pricerange-min') as HTMLInputElement | null;
    const maxInput = questionItem?.querySelector('.builtin-pricerange-max') as HTMLInputElement | null;
    const min = Number(minInput?.value);
    const max = Number(maxInput?.value);
    if (!minInput?.value || !maxInput?.value || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return {
        kind,
        error: text(options, 'editorBuiltInPriceRangeRequired', 'Enter a valid min/max price range for the built-in comparison question.'),
      };
    }
    return { kind, priceRange: { min, max } };
  }

  if (kind === 'timeFrame') {
    const startInput = questionItem?.querySelector('.builtin-timeframe-start') as HTMLInputElement | null;
    const endInput = questionItem?.querySelector('.builtin-timeframe-end') as HTMLInputElement | null;
    const start = startInput?.value ? new Date(startInput.value).getTime() : NaN;
    const end = endInput?.value ? new Date(endInput.value).getTime() : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
      return {
        kind,
        error: text(options, 'editorBuiltInTimeFrameRequired', 'Enter a valid date range for the built-in comparison question.'),
      };
    }
    return { kind, timeFrame: { start, end } };
  }

  if (kind === 'ageRange') {
    const ageInput = questionItem?.querySelector('.builtin-agerange-age') as HTMLInputElement | null;
    const minInput = questionItem?.querySelector('.builtin-agerange-min') as HTMLInputElement | null;
    const maxInput = questionItem?.querySelector('.builtin-agerange-max') as HTMLInputElement | null;
    const age = Number(ageInput?.value);
    const min = Number(minInput?.value);
    const max = Number(maxInput?.value);
    if (
      !ageInput?.value || !minInput?.value || !maxInput?.value ||
      !Number.isFinite(age) || !Number.isFinite(min) || !Number.isFinite(max) || min > max
    ) {
      return {
        kind,
        error: text(options, 'editorBuiltInAgeRangeRequired', 'Enter your age and a valid min/max acceptable partner age range.'),
      };
    }
    return { kind, ageRange: { age, acceptableRange: { min, max } } };
  }

  // 'location' needs no typed value of its own — it reuses the talk's own
  // authorLocation/locationRadiusMiles (see Question.builtIn doc comment, types.ts).
  return { kind };
}

/**
 * Pure DOM-read for a flow/survey talk's linear question list — shared by `processTalkForm`
 * (ui-manager.ts, save path) and the live "what the responder sees" preview
 * (talk-editor-preview.ts), which needs to read the CURRENT in-progress form state without
 * running validation/autofix/save. One read path, not two.
 */
export function collectFlowSurveyEditorQuestions(
  form: HTMLFormElement,
  type: 'flow' | 'survey',
  options: TalkEditorFormHelperOptions,
): { questions: any[]; selfAnswers: { questionId: string; answerId: string }[]; errors: string[] } {
  const questions: any[] = [];
  const selfAnswers: { questionId: string; answerId: string }[] = [];
  const errors: string[] = [];
  const questionItems = form.querySelectorAll('.question-item');

  questionItems.forEach((item, qIndex) => {
    const questionId = `q_${qIndex}`;
    const answerSelectionMode =
      (item.querySelector('.answer-selection-mode') as HTMLSelectElement | null)?.value === 'multiple'
        ? 'multiple'
        : 'single';
    // Spec §3.4 FR-QA-15/16, §30.8: a 'multiple'-mode question's self-answer is every
    // checked box (possibly several) — pushing one selfAnswers entry per checked value
    // reuses saveCreatedTalk's existing per-entry saveAnswerPreference loop unchanged,
    // which is exactly the substrate findAutoAnswerMultiple scans (one history event per
    // selected value under the same question).
    item.querySelectorAll<HTMLInputElement>(`input[name="self-answer-${questionId}"]:checked`).forEach((selfInput) => {
      if (selfInput.value !== 'ignore') {
        selfAnswers.push({ questionId, answerId: selfInput.value });
      }
    });
    const questionText = (item.querySelector('.question-text') as HTMLInputElement).value;
    const answerItems = item.querySelectorAll('.answer-item');

    const answers: any[] = [];
    answerItems.forEach((answerItem, aIndex) => {
      const answerText = (
        answerItem.querySelector('.answer-text') as HTMLInputElement
      ).value.trim();
      const nextQuestion = (answerItem.querySelector('.answer-next') as HTMLSelectElement).value;

      if (answerText) {
        const answer: any = {
          id: `a_${qIndex}_${aIndex}`,
          text: answerText,
        };

        if (type === 'survey') {
          // Surveys never branch; every answer carries a counter for stats.
          answer.counter = 0;
          answer.isTerminal = true;
          if (nextQuestion === 'ignore') {
            answer.isIgnore = true;
          }
        } else if (nextQuestion === 'ignore') {
          answer.isIgnore = true;
          answer.isTerminal = true;
        } else if (nextQuestion === 'noticed') {
          answer.isMatch = true;
          answer.isTerminal = true;
        } else if (nextQuestion) {
          // It's a question ID (e.g., "q_1")
          answer.nextQuestionId = nextQuestion;
        }

        answers.push(answer);
      }
    });

    const questionObj: any = {
      id: questionId,
      text: questionText,
      answers: answers,
    };
    if (answerSelectionMode === 'multiple') {
      questionObj.answerSelectionMode = 'multiple';
    }
    // docs/TODO.md §LL follow-up: only meaningful with exactly 1 real answer (matching
    // engine's own gate, myEffectiveTagContext/findReciprocalTagAncestor) — stored either
    // way so re-checking the box round-trips even while the answer count is temporarily
    // off (e.g. mid-edit).
    const reciprocalTagCheckbox = item.querySelector('.question-reciprocal-tag') as HTMLInputElement | null;
    if (reciprocalTagCheckbox?.checked) {
      questionObj.reciprocalTagContext = true;
    }
    // docs/TODO.md §LL follow-up: "Simple tag" (tagKind: 'simple') — the mutually exclusive
    // sibling of the Pair tag checkbox above (talk-editor-form-helpers.ts wires the
    // exclusion in the DOM). Applies to flow and survey alike, same shared branch.
    const simpleTagCheckbox = item.querySelector('.question-simple-tag') as HTMLInputElement | null;
    if (simpleTagCheckbox?.checked) {
      questionObj.tagKind = 'simple';
    }
    if (type === 'survey') {
      questionObj.isAggregatable = true;
      questionObj.contextHashId = '';
    }
    // §BB / spec §30.2: a builtIn question has no author-typed answers at all —
    // TalkAutofix.fix generates the 2 synthetic answers from questionObj.builtIn alone, so
    // force answers back to [] regardless of what the (hidden, unused) answer-item rows
    // produced above.
    const builtInRead = readBuiltInSpecFromQuestion(item, options);
    if (builtInRead.error) {
      errors.push(builtInRead.error);
    } else if (builtInRead.kind) {
      questionObj.answers = [];
      questionObj.builtIn = {
        kind: builtInRead.kind,
        ...(builtInRead.quantity !== undefined ? { quantity: builtInRead.quantity } : {}),
        ...(builtInRead.priceRange ? { priceRange: builtInRead.priceRange } : {}),
        ...(builtInRead.timeFrame ? { timeFrame: builtInRead.timeFrame } : {}),
        ...(builtInRead.ageRange ? { ageRange: builtInRead.ageRange } : {}),
      };
    }
    questions.push(questionObj);
  });

  return { questions, selfAnswers, errors };
}

export function updateAllAnswerDropdowns(options: TalkEditorFormHelperOptions): void {
  const questions = document.querySelectorAll('.question-item');
  const totalQuestions = questions.length;

  questions.forEach((questionItem, qIdx) => {
    // Spec §30.8: a 'multiple'-mode ("pick any that apply") question is always treated as
    // terminal for branching purposes — with several options potentially checked at once,
    // "go to question X" per-option would be ambiguous about which checked option's branch
    // wins. Restricted to Ignore/Noticed, same as the last question in the chain.
    const isMultiSelect = questionAnswerSelectionMode(questionItem) === 'multiple';
    const isLastQuestion = isMultiSelect || qIdx === totalQuestions - 1;
    const answersContainer = questionItem.querySelector('.answers-container');
    if (!answersContainer) return;

    const answerSelects = answersContainer.querySelectorAll('.answer-next');
    answerSelects.forEach((select) => {
      const currentValue = (select as HTMLSelectElement).value;

      // Last question: Ignore + Noticed only (no "go to next" — there is none).
      // Non-last questions: Ignore + go-to links only (no Noticed — only the last
      // question can produce a match; earlier questions must chain forward).
      const dropdownOptions = [`<option value="ignore">${text(options, 'editorIgnoreFilter', 'Ignore (filter out)')}</option>`];
      if (isLastQuestion) {
        dropdownOptions.push(`<option value="noticed">${text(options, 'editorNoticed', 'Noticed (match)')}</option>`);
      } else {
        for (let i = qIdx + 1; i < totalQuestions; i++) {
          dropdownOptions.push(`<option value="q_${i}">${format(options, 'editorGoToQuestion', 'Go to Question {count}', { count: i + 1 })}</option>`);
        }
      }

      select.innerHTML = dropdownOptions.join('');

      const sel = select as HTMLSelectElement;
      const optionExists = Array.from(sel.options).some((opt) => opt.value === currentValue);
      if (currentValue && optionExists) {
        sel.value = currentValue;
      } else if (!isLastQuestion) {
        // Previous value is gone (was "noticed" or a now-deleted question id).
        // Automatically redirect to the immediate next question.
        sel.value = `q_${qIdx + 1}`;
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
