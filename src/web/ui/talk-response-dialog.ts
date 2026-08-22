import { sessionAnswersToQAPairs } from '../../shared/flattened-answer-keys';
import { checkIfMatch, getRouteRootChildQuestionIds } from '../../shared/talk-engine';
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
  /** Spec §3.4 FR-QA-15/16, §30.8: the full checked set for a resolved multi-select preference. */
  answerIds?: string[];
} | null;

type ResponseDraft = {
  version: 1;
  currentQuestionId: string;
  /** `answerIds` (spec §3.4 FR-QA-15/16): the full checked set for an
   *  `answerSelectionMode: 'multiple'` question — `answerId` alone stays the first checked
   *  id, for backward-compat display; resuming a draft mid-multi-select isn't specifically
   *  exercised yet (known limitation, not a correctness issue — the full set still round-trips
   *  through JSON). */
  answers: Array<{ questionId: string; answerId: string; answerText: string; mode?: AnswerSelectionMode; answerIds?: string[] }>;
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

/**
 * Survey questions are independent (no match/ignore at the talk level) — every question is
 * required to have an "Ignore" option by TalkValidator, but for a survey that means "not
 * interested in THIS question," not "abandon the whole survey." Only the actual last question
 * should end the response; every other answer (ignore, terminal, whatever) just advances.
 * Used by both the manual click handler and the saved-preference auto-answer path — duplicating
 * this rule in two places is exactly what let a survey "Ignore" pick on question 1 of 3
 * short-circuit the whole response before (docs/TODO.md §W Gap 2 completeness note).
 */
export function nextSurveyQuestion(talk: any, currentQuestion: any): any | null {
  const qIdx = talk.questions.findIndex((q: { id: string }) => q.id === currentQuestion.id);
  if (qIdx >= 0 && qIdx < talk.questions.length - 1) {
    return talk.questions[qIdx + 1];
  }
  return null;
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
  /**
   * `meta.withholdFromSender` — set when the receiver picked the dedicated "Ignore" choice
   * (the always-present opt-out row, distinct from any of the asker's own provided answers —
   * see the `answerId === 'ignore'` sentinel below): the sender must receive nothing at all,
   * not even a mismatch record. Local bookkeeping (this device's own answer history) still
   * happens as normal; only the peer submission is skipped.
   */
  completeTalk: (talk: any, answers: any[], outcome?: 'match' | 'mismatch', meta?: { withholdFromSender?: boolean }) => void;
  resolveAnswerPreferenceForTalkQuestion: (
    talk: any,
    questionIndex: number,
    previousQAPairs: Array<{ questionText: string; answerText: string }>,
    currentQuestion: { id: string; text?: string; answers?: any[]; answerSelectionMode?: string },
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

    // Stop at terminal / match / ignore answers — except for survey, where every answer
    // is isTerminal by construction (§W Gap 2 completeness note: "terminal" doesn't mean
    // "stop" there, only running out of questions does; the linear-advance fallback below
    // already handles survey correctly once this doesn't break early).
    if (!answer) break;
    if (talk.type !== 'survey' && (answer.isTerminal || answer.isMatch || answer.isIgnore)) break;

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
  // Route talks in matchThreshold (multi-spec) mode always use the main step-by-step flow
  // below, never this pre-filled review screen — the review screen lists every one of
  // `talk.questions` at once, including the root's own "pick a branch" question, which
  // matchThreshold mode deliberately skips (see the multi-branch walk further down). Scope
  // cut, not a bug: pre-filled/superseded review for matchThreshold routes is a follow-up.
  const isMatchThresholdRoute = talk.type === 'route' && talk.matchThreshold != null;
  if (!skipAutoAnswer && !isMatchThresholdRoute) {
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
  const answers: { questionId: string; answerId: string; answerText: string; mode?: AnswerSelectionMode; answerIds?: string[] }[] =
    draft?.answers || [];

  // matchThreshold-mode route (spec §30.2 multi-spec matching): each of the root's direct
  // children is an independent spec to walk in sequence, order the author declared them in —
  // never the root's own "pick a branch" question itself, which this mode skips entirely.
  const routeChildIds = getRouteRootChildQuestionIds(talk);
  if (routeChildIds) {
    const answeredIds = new Set(answers.map((a) => a.questionId));
    const nextSpecId = routeChildIds.find((id) => !answeredIds.has(id));
    currentQuestion = nextSpecId ? talk.questions.find((q: any) => q.id === nextSpecId) : undefined;
  }

  const completeAndClose = (outcome: 'match' | 'mismatch' = 'mismatch'): void => {
    clearResponseDraft(talk);
    options.completeTalk(talk, answers, outcome);
    closeModal();
  };

  /**
   * matchThreshold-mode route only: after one spec's answer is recorded, advance to the next
   * unvisited spec instead of letting that spec's own isMatch/isIgnore/isTerminal flags decide
   * anything — an individual spec matching or not matching is never the final outcome by
   * itself, only the aggregate score is (see `checkIfMatchOrRouteScore` below). Returns true
   * (and re-renders) when there's another spec to walk to; false once every spec is answered,
   * meaning the caller should complete now.
   */
  const tryAdvanceToNextRouteSpec = (): boolean => {
    if (!routeChildIds) return false;
    const answeredIds = new Set(answers.map((a) => a.questionId));
    const nextSpecId = routeChildIds.find((id) => !answeredIds.has(id));
    if (!nextSpecId) return false;
    const nextQuestion = talk.questions.find((q: any) => q.id === nextSpecId);
    if (!nextQuestion) return false;
    currentQuestion = nextQuestion;
    saveResponseDraft(talk, currentQuestion.id, answers);
    renderQuestion();
    return true;
  };

  /** matchThreshold-mode route only: every spec has been answered — the real outcome is the
   *  aggregate score against `matchThreshold` (checkIfMatch's route branch), never whatever an
   *  individual spec's own flags would otherwise imply. */
  const completeRouteWalk = (): void => {
    completeAndClose(checkIfMatch(talk, answers) ? 'match' : 'mismatch');
  };

  /**
   * Fan-out (Answer.nextQuestionIds/parallelMatchThreshold, types.ts): the any-node
   * generalization of the matchThreshold-only mechanism above. Unlike `routeChildIds`
   * (seeded once, root-only, before the first question even renders), a fan-out can appear
   * at ANY point mid-walk — e.g. after choosing "iPhone", that answer's own `nextQuestionIds`
   * only becomes known once "iPhone" is actually picked. `pendingSpecQueue` accumulates every
   * spec id from every fan-out seen so far in this walk (including nested ones — a spec that
   * itself fans out further just appends more ids to the same flat queue), and every
   * answer-recording site below calls this right after pushing to `answers`, whether or not
   * that particular answer itself introduced a new fan-out — an earlier fan-out's still-queued
   * siblings must still be walked even when the current answer is an ordinary leaf.
   */
  const pendingSpecQueue: string[] = [];
  const advanceAfterFanOutAnswer = (chosenAnswer: any): boolean => {
    if (Array.isArray(chosenAnswer?.nextQuestionIds)) {
      for (const id of chosenAnswer.nextQuestionIds) {
        if (!pendingSpecQueue.includes(id)) pendingSpecQueue.push(id);
      }
    }
    if (pendingSpecQueue.length === 0) return false;
    const answeredIds = new Set(answers.map((a) => a.questionId));
    const nextSpecId = pendingSpecQueue.find((id) => !answeredIds.has(id));
    if (nextSpecId) {
      const nextQuestion = talk.questions.find((q: any) => q.id === nextSpecId);
      if (nextQuestion) {
        currentQuestion = nextQuestion;
        saveResponseDraft(talk, currentQuestion.id, answers);
        renderQuestion();
        return true;
      }
    }
    // Every queued spec answered — the outcome is the recursive fan-out evaluation
    // (`evaluateRouteFanOutMatch` via `checkIfMatch`), never this particular leaf's own flags.
    completeAndClose(checkIfMatch(talk, answers) ? 'match' : 'mismatch');
    return true;
  };

  const renderQuestion = (): void => {
    if (!currentQuestion) {
      if (routeChildIds) {
        completeRouteWalk();
        return;
      }
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
        // The receiver's own opt-out (see applyChoice) — ends the whole talk immediately
        // regardless of talk type or question position; the sender receives nothing.
        answers.push({
          questionId: currentQuestion.id,
          answerId: 'ignore',
          answerText: 'ignore',
          mode: 'auto',
        });
        options.showNotification(text('responseTalkIgnoredAuto', 'Talk ignored - no match (auto)'), 'info');
        clearResponseDraft(talk);
        options.completeTalk(talk, answers, 'mismatch', { withholdFromSender: true });
        closeModal();
        return;
      }
      if (savedPreference.answerIds && savedPreference.answerIds.length > 0) {
        // Spec §3.4 FR-QA-15/16, §30.8: a resolved multi-select ("pick any that apply")
        // preference — always chain-terminal (§30.8/talk-editor-form-helpers.ts), so unlike
        // the single-answer branch below there's no isTerminal/nextQuestionId to follow.
        // Outcome comes from the canonical set-intersection checkIfMatch, never a single
        // answer's own isMatch/isIgnore flag (which would be wrong here — any one of several
        // checked options being isMatch-flagged is enough).
        answers.push({
          questionId: currentQuestion.id,
          answerId: savedPreference.answerId,
          answerIds: savedPreference.answerIds,
          answerText: savedPreference.answerText,
          mode: 'auto',
        });
        if (routeChildIds) {
          if (tryAdvanceToNextRouteSpec()) return;
          completeRouteWalk();
          return;
        }
        if (advanceAfterFanOutAnswer(undefined)) return;
        if (checkIfMatch(talk, answers)) {
          clearResponseDraft(talk);
          options.completeTalk(talk, answers, 'match');
          options.showNotification(text('responseMatchAuto', 'Match! You both noticed each other. (auto)'), 'success');
          closeModal();
        } else {
          options.showNotification(text('responseTalkIgnoredAuto', 'Talk ignored - no match (auto)'), 'info');
          completeAndClose();
        }
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

        if (routeChildIds) {
          if (tryAdvanceToNextRouteSpec()) return;
          completeRouteWalk();
          return;
        }
        if (advanceAfterFanOutAnswer(answer)) return;
        if (talk.type === 'survey') {
          // A valid (asker-provided) answer always advances; only the last question ends
          // the response (see applyChoice's identical rule for the manual path).
          const next = nextSurveyQuestion(talk, currentQuestion);
          if (next) {
            currentQuestion = next;
            saveResponseDraft(talk, currentQuestion.id, answers);
            renderQuestion();
            return;
          }
          completeAndClose();
          return;
        }
        if (answer.isIgnore) {
          // Flow/route: an asker-designed terminal/mismatch branch — a real, complete
          // answer; the sender still receives it (unlike the dedicated-ignore case above).
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
    // Spec §3.4 FR-QA-15/16, §30.8: "pick any that apply" — a plain checklist + one Submit
    // action, not the auto/manual/permanent grid (which assumes exactly one final answer).
    // A multi-select question is always chain-terminal by construction (the talk editor
    // restricts its options to Ignore/Noticed only, no "go to next question"), so submitting
    // it always ends in a match or a mismatch/ignore, never advances to another question.
    const isMultiSelect = currentQuestion.answerSelectionMode === 'multiple';
    const previouslyCheckedIds = new Set(previousChoiceFromSession?.answerIds || []);

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
          ${isMultiSelect ? `
          <div class="answer-checkbox-list" data-testid="answer-checkbox-list">
            ${currentQuestion.answers
              .map(
                (answer: any) => `
              <label class="answer-checkbox-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;">
                <input type="checkbox" class="answer-checkbox" data-testid="answer-checkbox"
                  data-answer-id="${answer.id}"
                  data-answer-text="${options.escapeHtml(answer.text)}"
                  data-is-ignore="${answer.isIgnore || false}"
                  data-is-match="${answer.isMatch || false}"
                  ${previouslyCheckedIds.has(answer.id) ? 'checked' : ''}>
                <span>${options.escapeHtml(answer.text)}</span>
              </label>
            `,
              )
              .join('')}
          </div>
          <button type="button" class="btn primary-btn" id="submit-checkbox-answers-btn" data-testid="submit-checkbox-answers-btn" style="margin-top:12px;">${text('responseSubmit', 'Submit')}</button>
          ` : `
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
          `}
          ${talk.type === 'route' ? '<div class="route-branch-preview" data-testid="route-branch-preview"></div>' : ''}
        </div>
      </div>
    `;
    injectViewInMyAnswersLink(modal, options);

    const applyChoice = (radio: HTMLInputElement): void => {
      const answerId = radio.dataset.answerId!;
      // The receiver's own opt-out — a dedicated radio row rendered separately from
      // `currentQuestion.answers` (literal sentinel id "ignore"), distinct from any answer
      // the asker themselves provided. An asker-provided answer can ALSO carry
      // `data-is-ignore="true"` (e.g. a flow's designed "No" branch) — that's a real,
      // complete answer, not this.
      const isDedicatedIgnore = answerId === 'ignore';
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

      if (isDedicatedIgnore) {
        // Ignoring a question means ignoring the whole talk, at any question, in any talk
        // type — the sender must receive nothing at all, not even a mismatch record. Local
        // bookkeeping (this device's own history) still happens via completeTalk. Stays a
        // hard stop even in matchThreshold-route mode — an explicit opt-out on one spec is a
        // decision to withhold the whole response, not "this one spec didn't match."
        options.showNotification(text('responseTalkIgnored', 'Talk ignored - no match'), 'info');
        clearResponseDraft(talk);
        options.completeTalk(talk, answers, 'mismatch', { withholdFromSender: true });
        closeModal();
        return;
      }

      if (routeChildIds) {
        if (tryAdvanceToNextRouteSpec()) return;
        completeRouteWalk();
        return;
      }
      if (advanceAfterFanOutAnswer(currentQuestion.answers.find((a: any) => a.id === answerId))) return;

      if (talk.type === 'survey') {
        // Any valid (asker-provided) answer — regardless of its own isIgnore/isMatch/
        // isTerminal flags — advances to the next question; only the actual last question
        // ends the response. Only the dedicated Ignore choice above ends it early.
        const next = nextSurveyQuestion(talk, currentQuestion);
        if (next) {
          currentQuestion = next;
          saveResponseDraft(talk, currentQuestion.id, answers);
          renderQuestion();
          return;
        }
        completeAndClose();
      } else if (isMatch) {
        clearResponseDraft(talk);
        options.completeTalk(talk, answers, 'match');
        options.showNotification(text('responseMatch', 'Match! You both noticed each other.'), 'success');
        closeModal();
      } else if (isIgnore || isTerminal) {
        // Flow/route: the asker designed this branch to terminate here (e.g. a "No"
        // answer) — a real, complete answer; the sender still receives it.
        if (isIgnore) options.showNotification(text('responseTalkIgnored', 'Talk ignored - no match'), 'info');
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

    const applyCheckboxSubmit = (): void => {
      const checkedBoxes = Array.from(modal.querySelectorAll<HTMLInputElement>('.answer-checkbox:checked'));
      if (checkedBoxes.length === 0) {
        options.showNotification(text('responseSelectAtLeastOne', 'Select at least one option.'), 'warning');
        return;
      }
      const answerIds = checkedBoxes.map((cb) => cb.dataset.answerId!);
      const answerTexts = checkedBoxes.map((cb) => cb.dataset.answerText || '');

      const existingAnswer = answers.findIndex((answer) => answer.questionId === currentQuestion.id);
      const selectedAnswer = {
        questionId: currentQuestion.id,
        answerId: answerIds[0],
        answerIds,
        answerText: answerTexts.join(', '),
        mode: 'manual' as AnswerSelectionMode,
      };
      if (existingAnswer >= 0) answers.splice(existingAnswer, 1, selectedAnswer);
      else answers.push(selectedAnswer);

      // One saveAnswerPreference call per checked option — mirrors saveCreatedTalk's
      // per-entry pattern, building the multi-event history findAutoAnswerMultiple scans.
      answerIds.forEach((answerId, i) => {
        options.saveAnswerPreference(
          talk,
          talk.id,
          currentQuestion,
          answerId,
          answerTexts[i],
          answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
          'manual',
        );
      });

      if (routeChildIds) {
        if (tryAdvanceToNextRouteSpec()) return;
        completeRouteWalk();
        return;
      }
      // Multi-select is always chain-terminal (§30.8) — no nextQuestionIds of its own to
      // enqueue — but an earlier fan-out's still-queued siblings must still be walked.
      if (advanceAfterFanOutAnswer(undefined)) return;

      // A multi-select question is always chain-terminal (§30.8, see the editor's own
      // restriction to Ignore/Noticed-only options) — determine the outcome via the
      // canonical set-intersection checkIfMatch (talk-engine.ts), never reimplemented here.
      if (checkIfMatch(talk, answers)) {
        clearResponseDraft(talk);
        options.completeTalk(talk, answers, 'match');
        options.showNotification(text('responseMatch', 'Match! You both noticed each other.'), 'success');
        closeModal();
      } else {
        completeAndClose();
      }
    };
    modal.querySelector('#submit-checkbox-answers-btn')?.addEventListener('click', applyCheckboxSubmit);

    modal.querySelectorAll('.choice-radio').forEach((radioEl) => {
      radioEl.addEventListener('change', (event) => {
        const radio = event.target as HTMLInputElement;
        if (!radio.checked) return;
        if (talk.type !== 'route') {
          applyChoice(radio);
          return;
        }
        const nextQuestion = talk.questions.find((question: any) => question.id === radio.dataset.nextQuestionId);
        // matchThreshold-mode route: an individual spec's own isMatch/isIgnore flag never
        // decides the final outcome by itself (only the aggregate score does) — the normal
        // "leads to a match"/"ends this route" phrasing would be actively misleading here.
        const previewText = routeChildIds
          ? text('responseRouteSpecRecorded' as UiTranslationKey, 'This answer is recorded — continue to the next question')
          : nextQuestion
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
