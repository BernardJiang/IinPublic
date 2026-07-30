import { sessionAnswersToQAPairs } from '../../shared/flattened-answer-keys';
import type { UiTranslationKey } from './ui-translations';

type AnswerSelectionMode = 'auto' | 'manual' | 'permanent';

type SavedPreference = {
  answerId: string;
  answerText: string;
  mode: string;
  questionText?: string;
  allAnswers?: any[];
  autoAnswerAction?: string;
  autoAnswerReason?: string;
} | null;

type ResponseDraft = {
  version: 1;
  currentQuestionId: string;
  answers: Array<{ questionId: string; answerId: string; answerText: string; mode?: AnswerSelectionMode }>;
};

function responseDraftKey(talkId: string): string {
  return `iinpublic:talk-response-draft:${talkId}`;
}

function loadResponseDraft(talk: any): ResponseDraft | null {
  try {
    const raw = localStorage.getItem(responseDraftKey(talk.id));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ResponseDraft;
    if (
      draft?.version !== 1 ||
      !Array.isArray(draft.answers) ||
      !talk.questions?.some((question: any) => question.id === draft.currentQuestionId) ||
      !draft.answers.every((answer) => talk.questions?.some((question: any) => question.id === answer.questionId))
    ) {
      localStorage.removeItem(responseDraftKey(talk.id));
      return null;
    }
    return draft;
  } catch {
    return null;
  }
}

function saveResponseDraft(talk: any, currentQuestionId: string, answers: ResponseDraft['answers']): void {
  try {
    localStorage.setItem(responseDraftKey(talk.id), JSON.stringify({ version: 1, currentQuestionId, answers } satisfies ResponseDraft));
  } catch {
    // A blocked or full local storage should not prevent answering a talk.
  }
}

function clearResponseDraft(talk: any): void {
  try {
    localStorage.removeItem(responseDraftKey(talk.id));
  } catch {
    // Keep completion resilient when local storage is unavailable.
  }
}

type TalkResponseDialogOptions = {
  talk: any;
  skipAutoAnswer?: boolean;
  /**
   * REQ-CHATBOT-03/04: Set to true when this talk was previously answered and has since
   * been updated (TALK_SUPERSEDED event received). Forces a review screen with a contextual
   * banner even when all questions can be auto-filled.
   */
  isTalkSuperseded?: boolean;
  /** Display name of the talk sender — shown in the TALK_SUPERSEDED review banner. */
  senderName?: string;
  escapeHtml: (text: string) => string;
  showNotification: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  completeTalk: (talk: any, answers: any[], outcome?: 'match' | 'mismatch') => void;
  resolveAnswerPreferenceForTalkQuestion: (
    talk: any,
    questionIndex: number,
    previousQAPairs: Array<{ questionText: string; answerText: string }>,
    currentQuestion: { id: string; text?: string },
    talkInstanceId: string,
  ) => SavedPreference;
  saveAnswerPreference: (
    talk: any,
    talkInstanceId: string,
    currentQuestion: { id: string; text?: string; answers?: any[] },
    answerId: string,
    answerText: string,
    fullSessionAnswersIncludingCurrent: Array<{ questionId: string; answerText?: string }>,
    mode?: 'auto' | 'manual' | 'permanent' | 'suppressed',
  ) => void;
  text?: (key: UiTranslationKey) => string;
  /** TODO §Q: Talk → Me-tab Q&A reverse edge. Present only when this talk has already been
   *  answered by me — shows a "View in My Answers" link that jumps to the Me-tab entry. */
  viewInMyAnswers?: () => void;
  /** TODO §P: per-question deep link. When viewing a multi-question review, scrolls to and
   *  highlights the `.review-question-block` for this questionId instead of just landing on
   *  the talk as a whole. */
  targetQuestionId?: string;
};

/**
 * Pre-scan: try to collect all auto-fill answers for a linear flow/survey talk.
 *
 * Walks the talk question chain (following nextQuestionId / answer.nextQuestionId)
 * using `resolveAnswerPreferenceForTalkQuestion`. Returns the full auto-answer set
 * if every question resolves with mode === 'auto', or null if any question is unanswered
 * or if the talk type is 'tag' (handled separately) or 'route' (branching, skip pre-scan).
 */
function tryCollectAllAutoAnswers(
  talk: any,
  resolveAnswerPreference: TalkResponseDialogOptions['resolveAnswerPreferenceForTalkQuestion'],
): Array<{ questionId: string; answerId: string; answerText: string; mode: string }> | null {
  if (!Array.isArray(talk.questions) || talk.questions.length === 0) return null;
  // Route talks have branching paths — skip pre-scan; let the iterative renderer handle them
  if (talk.type === 'route') return null;

  const collected: Array<{ questionId: string; answerId: string; answerText: string; mode: string }> = [];
  let currentQ = talk.questions[0];

  while (currentQ) {
    const idx = talk.questions.findIndex((q: any) => q.id === currentQ.id);
    const previousPairs = collected.map((a, i) => ({
      questionText: talk.questions[i]?.text || '',
      answerText: a.answerText,
    }));
    const pref = resolveAnswerPreference(talk, idx, previousPairs, currentQ, talk.id);
    if (!pref || pref.mode !== 'auto') return null; // unanswered or manual — can't pre-fill all
    if (pref.answerId === 'ignore') return null; // ignore-auto is terminal but not a positive flow

    const answer = (currentQ.answers || []).find((a: any) => a.id === pref.answerId);
    collected.push({
      questionId: currentQ.id,
      answerId: pref.answerId,
      answerText: pref.answerText,
      mode: 'auto',
    });

    // Stop at terminal / match / ignore answers
    if (!answer || answer.isTerminal || answer.isMatch || answer.isIgnore) break;

    // Advance to next question
    const nextId = answer.nextQuestionId || currentQ.nextQuestionId;
    if (!nextId) {
      // Survey: advance linearly
      const nextIdx = talk.questions.findIndex((q: any) => q.id === currentQ.id) + 1;
      currentQ = talk.questions[nextIdx] ?? null;
    } else {
      currentQ = talk.questions.find((q: any) => q.id === nextId) ?? null;
    }
  }

  return collected.length > 0 ? collected : null;
}

function estimateCompletionMinutes(questionCount: number): number {
  return Math.max(1, Math.ceil(Math.max(1, questionCount) * 0.45));
}

function renderStepIndicator(
  talk: any,
  currentQuestionIndex: number,
  answers: Array<{ questionId: string }>,
  text: (key: UiTranslationKey, fallback: string) => string,
  escapeHtml: (text: string) => string,
): string {
  const questions = Array.isArray(talk.questions) ? talk.questions : [];
  const total = questions.length;
  if (total <= 1) return '';
  const completedIds = new Set(answers.map((answer) => answer.questionId));
  const dots = questions.map((question: any, index: number) => {
    const state = index === currentQuestionIndex
      ? 'current'
      : completedIds.has(question.id)
        ? 'done'
        : 'pending';
    return `<span class="response-step-dot response-step-${state}" aria-hidden="true"></span>`;
  }).join('');
  const minutes = estimateCompletionMinutes(total);
  const timeLabel = text(minutes === 1 ? 'responseEstimateMinute' : 'responseEstimateMinutes', '~{count} min')
    .replace('{count}', String(minutes));
  return `
    <div class="response-step-panel">
      <div class="response-step-summary">
        <span>${escapeHtml(text('responseQuestion', 'Question'))} ${currentQuestionIndex + 1} ${escapeHtml(text('responseOf', 'of'))} ${total}</span>
        <span>${escapeHtml(timeLabel)}</span>
      </div>
      <div class="response-step-dots" aria-label="${escapeHtml(text('responseProgress', 'Response progress'))}">
        ${dots}
      </div>
    </div>
  `;
}

/**
 * TODO §Q: Talk → Me-tab Q&A reverse edge. Appends a small "View in My Answers" link into the
 * modal header, common to all talk-type branches, right before each is attached to the DOM.
 */
function injectViewInMyAnswersLink(modal: HTMLElement, options: TalkResponseDialogOptions): void {
  if (!options.viewInMyAnswers) return;
  const header = modal.querySelector('.modal-header');
  if (!header) return;
  const link = document.createElement('button');
  link.type = 'button';
  link.id = 'view-in-my-answers-btn';
  link.className = 'btn';
  link.style.cssText = 'margin-top:8px;font-size:0.85em;';
  link.textContent = options.text?.('talksViewInMyAnswers') || 'View in My Answers';
  link.addEventListener('click', () => options.viewInMyAnswers?.());
  header.appendChild(link);
}

/**
 * TODO §P: per-question deep link. Scrolls/highlights the `.review-question-block` matching
 * `options.targetQuestionId`, so opening a multi-question entry from a specific answer lands on
 * that question instead of only the talk's first screen.
 */
function scrollToTargetQuestion(modal: HTMLElement, options: TalkResponseDialogOptions): void {
  if (!options.targetQuestionId) return;
  const escape = (window.CSS?.escape ?? ((v: string) => v)) as (v: string) => string;
  const block = modal.querySelector(`.review-question-block[data-question-id="${escape(options.targetQuestionId)}"]`);
  if (!block) return;
  block.scrollIntoView({ behavior: 'smooth', block: 'center' });
  block.classList.add('answer-item-highlighted');
  window.setTimeout(() => block.classList.remove('answer-item-highlighted'), 2000);
}

export function showTalkResponseDialog(options: TalkResponseDialogOptions): void {
  const { talk } = options;
  const text = (key: UiTranslationKey, fallback: string): string => options.text?.(key) || fallback;
  const skipAutoAnswer = options.skipAutoAnswer ?? false;
  const isTalkSuperseded = options.isTalkSuperseded ?? false;
  const senderName = options.senderName ?? '';
  // Only one response modal at a time. Opening a second incoming talk while a previous
  // response dialog is still in the DOM used to stack modals that share the fixed id
  // `talk-response-modal` (and, in the tag branch, `tag-match-checkbox` / `tag-submit-response`).
  // A stacked duplicate made a later tag talk's submit read the FIRST modal's unchecked box,
  // recording a match as a mismatch. Remove any prior dialog before opening this one.
  document.querySelectorAll('#talk-response-modal').forEach((el) => el.remove());
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'talk-response-modal';

  const closeModal = (): void => {
    if (document.body.contains(modal)) {
      document.body.removeChild(modal);
    }
  };

  if (talk.type === 'tag') {
    const q = talk.questions?.[0];
    if (!q || !q.answers?.length) {
      options.showNotification(text('responseInvalidTag', 'Invalid tag'), 'error');
      return;
    }
    const matchAnswer = q.answers.find((a: any) => a.isMatch);
    const ignoreAnswer = q.answers.find((a: any) => a.isIgnore);
    const savedTagPreference = options.resolveAnswerPreferenceForTalkQuestion(talk, 0, [], q, talk.id);
    const isSavedMatch =
      !!savedTagPreference &&
      !!matchAnswer &&
      (savedTagPreference.answerId === matchAnswer.id ||
        savedTagPreference.answerText?.toLowerCase() === (matchAnswer.text || '').toLowerCase());

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header">
          <h2 class="modal-title">${options.escapeHtml(talk.title)}</h2>
          <p>${text('responseTagHelp', 'Tag - check to match, leave unchecked to ignore')}</p>
        </div>
        <div style="padding: 20px;">
          <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 20px;">
            ${options.escapeHtml(q.text)}
          </div>
          <label class="tag-checkbox-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 1.1em;">
            <input type="checkbox" id="tag-match-checkbox" class="tag-match-checkbox" ${isSavedMatch ? 'checked' : ''}>
            <span>${text('responseInterested', "Match (I'm interested)")}</span>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn primary-btn" id="tag-submit-response">${text('responseSubmit', 'Submit')}</button>
          </div>
        </div>
      </div>
    `;
    injectViewInMyAnswersLink(modal, options);
    document.body.appendChild(modal);
    // Scope to THIS modal so a second stacked dialog can't read the first modal's checkbox
    // (fixed ids would otherwise resolve to the first-opened modal via document.getElementById).
    const checkbox = modal.querySelector('#tag-match-checkbox') as HTMLInputElement | null;
    const submitButton = modal.querySelector('#tag-submit-response') as HTMLButtonElement | null;
    const answers: { questionId: string; answerId: string; answerText: string }[] = [];
    const completeFromCheckbox = (checked: boolean) => {
      const answer = checked && matchAnswer ? matchAnswer : ignoreAnswer;
      if (!answer) {
        options.completeTalk(talk, [], 'mismatch');
      } else {
        answers.push({
          questionId: q.id,
          answerId: answer.id,
          answerText: answer.text || (checked ? 'Match.' : 'Ignore.'),
        });
        options.saveAnswerPreference(
          talk,
          talk.id,
          q,
          answer.id,
          answer.text || (checked ? 'Match.' : 'Ignore.'),
          answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
          'auto',
        );
        if (checked && matchAnswer) {
          options.showNotification(text('responseMatch', 'Match! You both noticed each other.'), 'success');
          options.completeTalk(talk, answers, 'match');
        } else {
          options.showNotification(text('responseTagIgnored', 'Tag ignored - no match'), 'info');
          options.completeTalk(talk, answers, 'mismatch');
        }
      }
      closeModal();
    };
    submitButton?.addEventListener('click', () => completeFromCheckbox(!!checkbox?.checked));
    return;
  }

  if (!Array.isArray(talk.questions) || talk.questions.length === 0) {
    options.showNotification(text('responseMissingQuestions', 'Could not load talk (missing questions).'), 'error');
    return;
  }

  // ── REQ-CHATBOT-02/03/04: Differential review screen ────────────────────────
  // If all questions can be auto-answered OR the talk was superseded (updated since
  // last answer), show a review screen instead of silently submitting.
  // The user must explicitly confirm pre-filled answers — no silent auto-submit.
  if (!skipAutoAnswer) {
    const allAutoAnswers = tryCollectAllAutoAnswers(talk, options.resolveAnswerPreferenceForTalkQuestion);
    const needsReview = isTalkSuperseded || (allAutoAnswers !== null && allAutoAnswers.length > 0);

    if (needsReview) {
      // Build the review answers — start from auto-filled set (may be partial for superseded)
      const reviewAnswers: { questionId: string; answerId: string; answerText: string; mode: string }[] =
        allAutoAnswers ?? [];

      const supersededBanner = isTalkSuperseded
        ? `<div class="chatbot-review-banner" style="background:var(--warning-soft);border:1px solid var(--warning-border);border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:0.95em;">
            ${senderName
              ? `<strong>${options.escapeHtml(senderName)}</strong> updated this talk.`
              : 'This talk was updated.'}
            Your previous answers are pre-filled — please review and answer any new questions.
           </div>`
        : '';

      // Render summary rows for pre-filled answers
      const summaryRows = talk.questions
        .map((q: any) => {
          const filled = reviewAnswers.find((a) => a.questionId === q.id);
          const answersHtml = (q.answers || [])
            .map((a: any) => {
              const isSelected = filled?.answerId === a.id;
              return `<label class="review-answer-option${isSelected ? ' review-answer-selected' : ''}" style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px 8px;border-radius:4px;${isSelected ? 'background:var(--accent-soft);font-weight:600;' : ''}">
                <input type="radio" name="review-${q.id}" value="${a.id}"
                  data-question-id="${q.id}"
                  data-answer-id="${a.id}"
                  data-answer-text="${options.escapeHtml(a.text)}"
                  ${isSelected ? 'checked' : ''} style="accent-color:var(--accent);">
                ${options.escapeHtml(a.text)}
                ${isSelected && filled?.mode === 'auto' ? '<span style="font-size:0.8em;color:#888;margin-left:4px;">(pre-filled)</span>' : ''}
              </label>`;
            })
            .join('');
          return `<div class="review-question-block" data-question-id="${options.escapeHtml(q.id)}" style="margin-bottom:18px;">
            <div style="font-weight:600;margin-bottom:8px;">${options.escapeHtml(q.text)}</div>
            <div class="review-answers-list">${answersHtml}</div>
            ${!filled ? `<p style="color:#999;font-size:0.9em;font-style:italic;">— ${text('responseNeedsInput' as UiTranslationKey, 'Please choose an answer')}</p>` : ''}
          </div>`;
        })
        .join('');

      modal.innerHTML = `
        <div class="modal-content" style="max-width:620px;">
          <div class="modal-header">
            <h2 class="modal-title">${options.escapeHtml(talk.title)}</h2>
            <p style="color:#666;font-size:0.9em;">${text('responseReviewPrompt' as UiTranslationKey, 'Review your answers before submitting')}</p>
          </div>
          <div style="padding:20px;">
            ${supersededBanner}
            ${summaryRows}
            <div style="display:flex;gap:12px;margin-top:20px;justify-content:flex-end;">
              <button type="button" class="btn btn-secondary" id="review-edit-btn">
                ${text('responseEditAnswers' as UiTranslationKey, 'Edit answers manually')}
              </button>
              <button type="button" class="btn btn-primary" id="review-submit-btn">
                ${text('responseConfirmSubmit' as UiTranslationKey, 'Confirm & Submit')}
              </button>
            </div>
          </div>
        </div>`;

      injectViewInMyAnswersLink(modal, options);
      document.body.appendChild(modal);
      scrollToTargetQuestion(modal, options);

      // Live update reviewAnswers when user selects a radio
      modal.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((radio) => {
        radio.addEventListener('change', () => {
          const qId = radio.dataset.questionId!;
          const aId = radio.dataset.answerId!;
          const aText = radio.dataset.answerText || '';
          const idx = reviewAnswers.findIndex((a) => a.questionId === qId);
          if (idx >= 0) {
            reviewAnswers[idx] = { questionId: qId, answerId: aId, answerText: aText, mode: 'manual' };
          } else {
            reviewAnswers.push({ questionId: qId, answerId: aId, answerText: aText, mode: 'manual' });
          }
        });
      });

      // "Edit manually" — close review, reopen with skipAutoAnswer=true
      modal.querySelector('#review-edit-btn')?.addEventListener('click', () => {
        if (document.body.contains(modal)) document.body.removeChild(modal);
        showTalkResponseDialog({ ...options, skipAutoAnswer: true, isTalkSuperseded: false });
      });

      // "Confirm & Submit" — validate, save prefs, complete
      modal.querySelector('#review-submit-btn')?.addEventListener('click', () => {
        // Check all questions are answered
        const unanswered = talk.questions.find((q: any) => !reviewAnswers.find((a) => a.questionId === q.id));
        if (unanswered) {
          options.showNotification(
            text('responseAnswerAllQuestions' as UiTranslationKey, 'Please answer all questions before submitting.'),
            'warning',
          );
          return;
        }
        // Save preferences and determine outcome
        const finalAnswers = reviewAnswers.map((a) => ({
          questionId: a.questionId,
          answerId: a.answerId,
          answerText: a.answerText,
          mode: a.mode as AnswerSelectionMode,
        }));
        finalAnswers.forEach((a, i) => {
          const q = talk.questions.find((tq: any) => tq.id === a.questionId);
          if (!q) return;
          options.saveAnswerPreference(
            talk,
            talk.id,
            q,
            a.answerId,
            a.answerText,
            finalAnswers.slice(0, i + 1).map((x) => ({ questionId: x.questionId, answerText: x.answerText })),
            a.mode as 'auto' | 'manual' | 'permanent',
          );
        });
        // Determine outcome from last answer's flags
        const lastQ = talk.questions.find((q: any) => finalAnswers.find((a) => a.questionId === q.id && q.answers?.find((ans: any) => ans.id === a.answerId && ans.isMatch)));
        const outcome = lastQ ? 'match' : 'mismatch';
        if (document.body.contains(modal)) document.body.removeChild(modal);
        options.completeTalk(talk, finalAnswers, outcome);
      });

      return; // Review screen handled — do not fall through to linear flow
    }
  }

  const draft = loadResponseDraft(talk);
  let currentQuestion = talk.questions.find((question: any) => question.id === draft?.currentQuestionId) || talk.questions[0];
  const answers: { questionId: string; answerId: string; answerText: string; mode?: AnswerSelectionMode }[] = draft?.answers || [];

  const completeAndClose = (outcome: 'match' | 'mismatch' = 'mismatch'): void => {
    clearResponseDraft(talk);
    options.completeTalk(talk, answers, outcome);
    closeModal();
  };

  const renderQuestion = (): void => {
    if (!currentQuestion) {
      completeAndClose();
      return;
    }

    const currentQuestionIndex = talk.questions.findIndex((q: { id: string }) => q.id === currentQuestion.id);
    const previousPairs = sessionAnswersToQAPairs(talk, answers);
    const savedPreference = skipAutoAnswer
      ? null
      : options.resolveAnswerPreferenceForTalkQuestion(
          talk,
          currentQuestionIndex,
          previousPairs,
          currentQuestion,
          talk.id,
        );

    if (savedPreference && savedPreference.mode === 'auto') {
      if (savedPreference.answerId === 'ignore') {
        answers.push({
          questionId: currentQuestion.id,
          answerId: 'ignore',
          answerText: 'ignore',
          mode: 'auto',
        });
        options.showNotification(text('responseTalkIgnoredAuto', 'Talk ignored - no match (auto)'), 'info');
        completeAndClose();
        return;
      }
      const answer = currentQuestion.answers.find((a: any) => a.id === savedPreference.answerId);
      if (answer) {
        answers.push({
          questionId: currentQuestion.id,
          answerId: savedPreference.answerId,
          answerText: savedPreference.answerText,
          mode: (savedPreference.mode as 'auto' | 'manual') || 'auto',
        });

        if (answer.isIgnore) {
          options.showNotification(text('responseTalkIgnoredAuto', 'Talk ignored - no match (auto)'), 'info');
          completeAndClose();
          return;
        }
        if (answer.isMatch) {
          clearResponseDraft(talk);
          options.completeTalk(talk, answers, 'match');
          options.showNotification(text('responseMatchAuto', 'Match! You both noticed each other. (auto)'), 'success');
          closeModal();
          return;
        }
        if (answer.isTerminal) {
          completeAndClose();
          return;
        }
        if (answer.nextQuestionId) {
          currentQuestion = talk.questions.find((q: any) => q.id === answer.nextQuestionId);
          if (currentQuestion) {
            renderQuestion();
          } else {
            completeAndClose();
          }
          return;
        }
        completeAndClose();
        return;
      }
    }

    const choiceRadioName = `choice-${currentQuestion.id}`;
    const showBackButton = talk.type === 'flow' && answers.length > 0;
    const previousChoiceFromSession = answers.find((a) => a.questionId === currentQuestion.id);
    const previousPairsForDisplay = sessionAnswersToQAPairs(talk, answers);
    const savedPreferenceForDisplay = options.resolveAnswerPreferenceForTalkQuestion(
      talk,
      currentQuestionIndex,
      previousPairsForDisplay,
      currentQuestion,
      talk.id,
    );
    const previousChoice =
      previousChoiceFromSession ||
      (savedPreferenceForDisplay
        ? {
            answerId: savedPreferenceForDisplay.answerId,
            answerText: savedPreferenceForDisplay.answerText,
            mode: (savedPreferenceForDisplay.mode as 'auto' | 'manual') || 'manual',
          }
        : undefined);
    const stepIndicator = renderStepIndicator(talk, currentQuestionIndex, answers, text, options.escapeHtml);

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <h2 class="modal-title">${options.escapeHtml(talk.title)}</h2>
            <p>${text('responseQuestion', 'Question')} ${currentQuestionIndex + 1} ${text('responseOf', 'of')} ${talk.questions.length}</p>
          </div>
          <div class="response-header-actions">
            ${showBackButton ? `<button type="button" class="btn btn-back-question" data-testid="back-question-btn">← ${text('responsePrevious', 'Previous question')}</button>` : ''}
            <button type="button" class="icon-button response-close-button" data-testid="close-response-btn" aria-label="${text('responseClose', 'Close response')}">×</button>
          </div>
        </div>
        <div style="padding: 20px;">
          ${stepIndicator}
          <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 16px;">
            ${options.escapeHtml(currentQuestion.text)}
          </div>
          <div class="answer-radio-grid" role="radiogroup" aria-label="Choose answer and mode">
            <div class="answer-grid-header">
              <span>${text('responseAuto', 'Auto')}</span><span>${text('responseManual', 'Manual')}</span><span>${text('responsePermanent', 'Permanent')}</span><span></span>
            </div>
            ${currentQuestion.answers
              .map((answer: any) => {
                const prevMode = previousChoice?.answerId === answer.id ? (previousChoice?.mode ?? 'manual') : '';
                return `
              <div class="answer-grid-row">
                <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="${answer.id}_auto" class="choice-radio"
                  data-answer-id="${answer.id}"
                  data-answer-text="${options.escapeHtml(answer.text)}"
                  data-mode="auto"
                  data-is-terminal="${answer.isTerminal || false}"
                  data-is-ignore="${answer.isIgnore || false}"
                  data-is-match="${answer.isMatch || false}"
                  data-next-question-id="${answer.nextQuestionId || ''}"
                  ${prevMode === 'auto' ? 'checked' : ''}></label>
                <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="${answer.id}_manual" class="choice-radio"
                  data-answer-id="${answer.id}"
                  data-answer-text="${options.escapeHtml(answer.text)}"
                  data-mode="manual"
                  data-is-terminal="${answer.isTerminal || false}"
                  data-is-ignore="${answer.isIgnore || false}"
                  data-is-match="${answer.isMatch || false}"
                  data-next-question-id="${answer.nextQuestionId || ''}"
                  ${prevMode === 'manual' ? 'checked' : ''}></label>
                <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="${answer.id}_permanent" class="choice-radio"
                  data-answer-id="${answer.id}"
                  data-answer-text="${options.escapeHtml(answer.text)}"
                  data-mode="permanent"
                  data-is-terminal="${answer.isTerminal || false}"
                  data-is-ignore="${answer.isIgnore || false}"
                  data-is-match="${answer.isMatch || false}"
                  data-next-question-id="${answer.nextQuestionId || ''}"></label>
                <span class="answer-grid-label">${options.escapeHtml(answer.text)}</span>
              </div>
            `;
              })
              .join('')}
            <div class="answer-grid-row answer-grid-row-ignore">
              <label class="answer-grid-cell"><input type="radio" name="${choiceRadioName}" value="ignore" class="choice-radio ignore-radio"
                data-answer-id="ignore"
                data-answer-text="ignore"
                data-mode="manual"
                data-is-terminal="false"
                data-is-ignore="true"
                data-is-match="false"
                data-next-question-id=""
                ${previousChoice?.answerId === 'ignore' ? 'checked' : ''}></label>
              <span class="answer-grid-cell"></span>
              <span class="answer-grid-cell"></span>
              <span class="answer-grid-label">${text('responseIgnore', 'Ignore')}</span>
            </div>
          </div>
          ${talk.type === 'route' ? '<div class="route-branch-preview" data-testid="route-branch-preview"></div>' : ''}
        </div>
      </div>
    `;
    injectViewInMyAnswersLink(modal, options);

    const applyChoice = (radio: HTMLInputElement): void => {
      const answerId = radio.dataset.answerId!;
      const isIgnore = radio.dataset.isIgnore === 'true';
      const answerText = radio.dataset.answerText || '';
      const answerMode = (radio.dataset.mode || 'manual') as AnswerSelectionMode;
      const isTerminal = radio.dataset.isTerminal === 'true';
      const isMatch = radio.dataset.isMatch === 'true';
      const nextQuestionId = radio.dataset.nextQuestionId || '';

      const existingAnswer = answers.findIndex((answer) => answer.questionId === currentQuestion.id);
      const selectedAnswer = {
        questionId: currentQuestion.id,
        answerId,
        answerText: isIgnore ? 'ignore' : answerText,
        mode: answerMode,
      };
      if (existingAnswer >= 0) answers.splice(existingAnswer, 1, selectedAnswer);
      else answers.push(selectedAnswer);

      options.saveAnswerPreference(
        talk,
        talk.id,
        currentQuestion,
        answerId,
        isIgnore ? 'ignore' : answerText,
        answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
        isIgnore ? 'suppressed' : answerMode,
      );

      if (isIgnore) {
        options.showNotification(text('responseTalkIgnored', 'Talk ignored - no match'), 'info');
        completeAndClose();
      } else if (isMatch) {
        clearResponseDraft(talk);
        options.completeTalk(talk, answers, 'match');
        options.showNotification(text('responseMatch', 'Match! You both noticed each other.'), 'success');
        closeModal();
      } else if (isTerminal) {
        if (talk.type === 'survey') {
          const qIdx = talk.questions.findIndex((q: { id: string }) => q.id === currentQuestion.id);
          if (qIdx >= 0 && qIdx < talk.questions.length - 1) {
            currentQuestion = talk.questions[qIdx + 1];
            saveResponseDraft(talk, currentQuestion.id, answers);
            renderQuestion();
            return;
          }
        }
        completeAndClose();
      } else if (nextQuestionId) {
        const nextQ = talk.questions.find((q: any) => q.id === nextQuestionId);
        if (nextQ) {
          currentQuestion = nextQ;
          saveResponseDraft(talk, currentQuestion.id, answers);
          renderQuestion();
        } else {
          completeAndClose();
        }
      } else {
        completeAndClose();
      }
    };

    modal.querySelectorAll('.choice-radio').forEach((radioEl) => {
      radioEl.addEventListener('change', (event) => {
        const radio = event.target as HTMLInputElement;
        if (!radio.checked) return;
        if (talk.type !== 'route') {
          applyChoice(radio);
          return;
        }
        const nextQuestion = talk.questions.find((question: any) => question.id === radio.dataset.nextQuestionId);
        const previewText = nextQuestion
          ? text('responseRouteLeadsTo', 'This leads to: {question}').replace('{question}', nextQuestion.text || '')
          : radio.dataset.isMatch === 'true'
            ? text('responseRouteLeadsToMatch', 'This leads to a match')
            : radio.dataset.isIgnore === 'true'
              ? text('responseRouteLeadsToIgnore', 'This ends this route')
              : text('responseRouteLeadsToEnd', 'This ends this route');
        const preview = modal.querySelector<HTMLElement>('[data-testid="route-branch-preview"]');
        if (!preview) return;
        preview.innerHTML = `
          <div class="route-branch-preview-copy">${options.escapeHtml(previewText)}</div>
          <div class="route-branch-preview-actions">
            <button type="button" class="btn btn-secondary" data-testid="route-branch-change">${text('responseRouteChange', 'Change')}</button>
            <button type="button" class="btn btn-primary" data-testid="route-branch-continue">${text('responseRouteContinue', 'Continue')}</button>
          </div>`;
        preview.querySelector('[data-testid="route-branch-change"]')?.addEventListener('click', () => {
          radio.checked = false;
          preview.innerHTML = '';
        });
        preview.querySelector('[data-testid="route-branch-continue"]')?.addEventListener('click', () => applyChoice(radio));
      });
    });

    const backBtn = modal.querySelector('[data-testid="back-question-btn"]');
    backBtn?.addEventListener('click', () => {
      answers.pop();
      currentQuestion = talk.questions[currentQuestionIndex - 1];
      saveResponseDraft(talk, currentQuestion.id, answers);
      renderQuestion();
    });
    modal.querySelector('[data-testid="close-response-btn"]')?.addEventListener('click', closeModal);
  };

  document.body.appendChild(modal);
  renderQuestion();
}
