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

type TalkResponseDialogOptions = {
  talk: any;
  skipAutoAnswer?: boolean;
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
};

export function showTalkResponseDialog(options: TalkResponseDialogOptions): void {
  const { talk } = options;
  const text = (key: UiTranslationKey, fallback: string): string => options.text?.(key) || fallback;
  const skipAutoAnswer = options.skipAutoAnswer ?? false;
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
    document.body.appendChild(modal);
    const checkbox = document.getElementById('tag-match-checkbox') as HTMLInputElement | null;
    const submitButton = document.getElementById('tag-submit-response') as HTMLButtonElement | null;
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

  let currentQuestion = talk.questions[0];
  const answers: { questionId: string; answerId: string; answerText: string; mode?: AnswerSelectionMode }[] = [];

  const renderQuestion = (): void => {
    if (!currentQuestion) {
      options.completeTalk(talk, answers, 'mismatch');
      closeModal();
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
        options.completeTalk(talk, answers, 'mismatch');
        closeModal();
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
          options.completeTalk(talk, answers, 'mismatch');
          closeModal();
          return;
        }
        if (answer.isMatch) {
          options.completeTalk(talk, answers, 'match');
          options.showNotification(text('responseMatchAuto', 'Match! You both noticed each other. (auto)'), 'success');
          closeModal();
          return;
        }
        if (answer.isTerminal) {
          options.completeTalk(talk, answers, 'mismatch');
          closeModal();
          return;
        }
        if (answer.nextQuestionId) {
          currentQuestion = talk.questions.find((q: any) => q.id === answer.nextQuestionId);
          if (currentQuestion) {
            renderQuestion();
          } else {
            options.completeTalk(talk, answers, 'mismatch');
            closeModal();
          }
          return;
        }
        options.completeTalk(talk, answers);
        closeModal();
        return;
      }
    }

    const choiceRadioName = `choice-${currentQuestion.id}`;
    const showBackButton = currentQuestionIndex > 0;
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

    modal.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 12px;">
          <div>
            <h2 class="modal-title">${options.escapeHtml(talk.title)}</h2>
            <p>${text('responseQuestion', 'Question')} ${currentQuestionIndex + 1} ${text('responseOf', 'of')} ${talk.questions.length}</p>
          </div>
          ${showBackButton ? `<button type="button" class="btn btn-back-question" data-testid="back-question-btn">← ${text('responsePrevious', 'Previous question')}</button>` : ''}
        </div>
        <div style="padding: 20px;">
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
        </div>
      </div>
    `;

    const applyChoice = (radio: HTMLInputElement): void => {
      const answerId = radio.dataset.answerId!;
      const isIgnore = radio.dataset.isIgnore === 'true';
      const answerText = radio.dataset.answerText || '';
      const answerMode = (radio.dataset.mode || 'manual') as AnswerSelectionMode;
      const isTerminal = radio.dataset.isTerminal === 'true';
      const isMatch = radio.dataset.isMatch === 'true';
      const nextQuestionId = radio.dataset.nextQuestionId || '';

      answers.push({
        questionId: currentQuestion.id,
        answerId,
        answerText: isIgnore ? 'ignore' : answerText,
        mode: answerMode,
      });

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
        options.completeTalk(talk, answers, 'mismatch');
        closeModal();
      } else if (isMatch) {
        options.completeTalk(talk, answers, 'match');
        options.showNotification(text('responseMatch', 'Match! You both noticed each other.'), 'success');
        closeModal();
      } else if (isTerminal) {
        if (talk.type === 'survey') {
          const qIdx = talk.questions.findIndex((q: { id: string }) => q.id === currentQuestion.id);
          if (qIdx >= 0 && qIdx < talk.questions.length - 1) {
            currentQuestion = talk.questions[qIdx + 1];
            renderQuestion();
            return;
          }
        }
        options.completeTalk(talk, answers, 'mismatch');
        closeModal();
      } else if (nextQuestionId) {
        const nextQ = talk.questions.find((q: any) => q.id === nextQuestionId);
        if (nextQ) {
          currentQuestion = nextQ;
          renderQuestion();
        } else {
          options.completeTalk(talk, answers, 'mismatch');
          closeModal();
        }
      } else {
        options.completeTalk(talk, answers, 'mismatch');
        closeModal();
      }
    };

    modal.querySelectorAll('.choice-radio').forEach((radioEl) => {
      radioEl.addEventListener('change', (event) => {
        const radio = event.target as HTMLInputElement;
        if (radio.checked) applyChoice(radio);
      });
    });

    const backBtn = modal.querySelector('[data-testid="back-question-btn"]');
    backBtn?.addEventListener('click', () => {
      answers.pop();
      currentQuestion = talk.questions[currentQuestionIndex - 1];
      renderQuestion();
    });
  };

  document.body.appendChild(modal);
  renderQuestion();
}
