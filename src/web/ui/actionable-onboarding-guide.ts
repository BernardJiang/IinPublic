import { activateModalAccessibility } from './modal-accessibility';
import { STARTER_PRACTICE_BOTS, type StarterPracticeBotId } from './starter-practice-bots';
import { escapeHtml } from './ui-formatters';
import type { UiLanguage } from './ui-translations';

export type ActionableGuideResult =
  | { kind: 'dismissed' }
  | { kind: 'start-practice'; botId: StarterPracticeBotId }
  | { kind: 'start-talk'; customPrompt: string };

export interface ActionableOnboardingGuideDeps {
  text: (key: string, fallback?: string) => string;
  language: UiLanguage;
  onFinish: (result: ActionableGuideResult) => void;
  /** Temporarily hides this guide while the reference tour is open, then resumes it. */
  onShowProductTour: (resume: () => void) => void;
}

/**
 * Three-step first-run path that opens either a local-only practice Talk or a real, editable
 * Talk draft. It never broadcasts anything by itself.
 */
export function showActionableOnboardingGuide(deps: ActionableOnboardingGuideDeps): void {
  document.getElementById('actionable-guide-modal')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const modal = document.createElement('div');
  modal.id = 'actionable-guide-modal';
  modal.className = 'modal-overlay actionable-guide-overlay';
  modal.dataset.testid = 'actionable-guide-modal';
  document.body.appendChild(modal);

  let step = 0;
  let selectedBotId: StarterPracticeBotId | undefined;
  let customPrompt = '';
  let validationVisible = false;
  let deactivate = (): void => {};
  let finished = false;

  const finish = (result: ActionableGuideResult): void => {
    if (finished) return;
    finished = true;
    deactivate();
    modal.remove();
    deps.onFinish(result);
  };
  const dismiss = (): void => finish({ kind: 'dismissed' });
  const progress = (): string => deps.text('actionGuideProgress', '{current} of {total}')
    .replace('{current}', String(step + 1))
    .replace('{total}', '3');

  const render = (): void => {
    const sharedHeader = `
      <div class="modal-header actionable-guide-header">
        <span class="walkthrough-progress-label">${escapeHtml(progress())}</span>
        <button type="button" class="close-button" id="actionable-guide-close" data-testid="actionable-guide-close" aria-label="${escapeHtml(deps.text('actionGuideSkip', 'Skip for now'))}">&times;</button>
      </div>`;

    let content = '';
    if (step === 0) {
      content = `
        <div class="actionable-guide-hero">
          <div class="actionable-guide-icon" aria-hidden="true">💬</div>
          <h2 id="actionable-guide-title">${escapeHtml(deps.text('actionGuideWelcomeTitle', 'Build your own bot—one answer at a time.'))}</h2>
          <p id="actionable-guide-description">${escapeHtml(deps.text('actionGuideWelcomeBody', 'Teach it with real Talk examples. It repeats only the choices you approve.'))}</p>
        </div>`;
    } else if (step === 1) {
      const cards = STARTER_PRACTICE_BOTS.map((bot) => `
        <button type="button" class="actionable-starter-card${selectedBotId === bot.id ? ' selected' : ''}" data-practice-bot-id="${bot.id}" data-testid="actionable-starter-${bot.id}" aria-pressed="${selectedBotId === bot.id}">
          <span class="actionable-starter-icon" aria-hidden="true">${bot.icon}</span>
          <span><strong>${escapeHtml(deps.text(bot.nameKey, bot.id))}</strong><small>${escapeHtml(deps.text(bot.descKey, ''))}</small></span>
        </button>`).join('');
      content = `
        <div class="actionable-guide-copy">
          <h2 id="actionable-guide-title">${escapeHtml(deps.text('actionGuideChooseTitle', 'Which practice bot should teach you first?'))}</h2>
          <p id="actionable-guide-description">${escapeHtml(deps.text('actionGuideChooseBody', 'Each coach demonstrates a real feature without contacting another person.'))}</p>
        </div>
        <div class="actionable-starter-grid" role="group" aria-label="${escapeHtml(deps.text('actionGuideStarterAria', 'Starter Talks'))}">${cards}</div>
        <label class="actionable-custom-label" for="actionable-custom-prompt">${escapeHtml(deps.text('actionGuideCustomLabel', 'Or write your own'))}</label>
        <textarea id="actionable-custom-prompt" data-testid="actionable-custom-prompt" rows="3" maxlength="240" placeholder="${escapeHtml(deps.text('actionGuideCustomPlaceholder', 'For example: Would anyone like to practice a language together?'))}">${escapeHtml(customPrompt)}</textarea>
        <div class="actionable-guide-error" id="actionable-guide-error" role="alert" ${validationVisible ? '' : 'hidden'}>${escapeHtml(deps.text('actionGuideChooseRequired', 'Choose a practice bot or write what you want to say.'))}</div>`;
    } else {
      const selected = selectedBotId
        ? STARTER_PRACTICE_BOTS.find((bot) => bot.id === selectedBotId)
        : undefined;
      const choice = customPrompt || (selected ? deps.text(selected.nameKey, selected.id) : '');
      content = `
        <div class="actionable-guide-hero">
          <div class="actionable-guide-icon" aria-hidden="true">🛠️</div>
          <h2 id="actionable-guide-title">${escapeHtml(deps.text('actionGuideControlTitle', 'Your bot follows your answers.'))}</h2>
          <p id="actionable-guide-description">${escapeHtml(deps.text('actionGuideControlBody', 'Practice stays on this device. Nothing is sent to another person.'))}</p>
          <div class="actionable-choice-preview" data-testid="actionable-choice-preview">${escapeHtml(choice)}</div>
        </div>`;
    }

    modal.innerHTML = `
      <div class="modal-content size-m actionable-guide-card" role="dialog" aria-modal="true" aria-labelledby="actionable-guide-title" aria-describedby="actionable-guide-description" data-testid="actionable-guide-step-${step}">
        ${sharedHeader}
        <div class="actionable-guide-content">${content}</div>
        <div class="modal-actions actionable-guide-actions">
          ${step > 0 ? `<button type="button" class="btn" id="actionable-guide-back" data-testid="actionable-guide-back">${escapeHtml(deps.text('actionGuideBack', 'Back'))}</button>` : `<button type="button" class="btn" id="actionable-guide-skip" data-testid="actionable-guide-skip">${escapeHtml(deps.text('actionGuideSkip', 'Skip for now'))}</button>`}
          <div class="actionable-guide-forward-actions">
            ${step === 2 ? `<button type="button" class="btn" id="actionable-guide-product-tour" data-testid="actionable-guide-product-tour">${escapeHtml(deps.text('actionGuideHowItWorks', 'See how IinPublic works'))}</button>` : ''}
            <button type="button" class="btn primary-btn" id="actionable-guide-next" data-testid="actionable-guide-next">${escapeHtml(step === 2 ? deps.text('actionGuideReview', 'Start') : deps.text('actionGuideNext', 'Next'))}</button>
          </div>
        </div>
      </div>`;

    modal.querySelector('#actionable-guide-close')?.addEventListener('click', dismiss);
    modal.querySelector('#actionable-guide-skip')?.addEventListener('click', dismiss);
    modal.querySelector('#actionable-guide-back')?.addEventListener('click', () => {
      step -= 1;
      validationVisible = false;
      render();
    });
    modal.querySelectorAll<HTMLElement>('[data-practice-bot-id]').forEach((card) => {
      card.addEventListener('click', () => {
        selectedBotId = card.dataset.practiceBotId as StarterPracticeBotId;
        customPrompt = '';
        validationVisible = false;
        render();
      });
    });
    modal.querySelector<HTMLTextAreaElement>('#actionable-custom-prompt')?.addEventListener('input', (event) => {
      customPrompt = (event.currentTarget as HTMLTextAreaElement).value;
      if (customPrompt.trim()) {
        selectedBotId = undefined;
        validationVisible = false;
        modal.querySelectorAll('.actionable-starter-card.selected').forEach((card) => card.classList.remove('selected'));
        modal.querySelectorAll('.actionable-starter-card[aria-pressed="true"]').forEach((card) => card.setAttribute('aria-pressed', 'false'));
        modal.querySelector<HTMLElement>('#actionable-guide-error')?.setAttribute('hidden', '');
      }
    });
    modal.querySelector('#actionable-guide-product-tour')?.addEventListener('click', () => {
      deactivate();
      modal.hidden = true;
      modal.style.display = 'none';
      deps.onShowProductTour(() => {
        modal.hidden = false;
        modal.style.removeProperty('display');
        render();
      });
    });
    modal.querySelector('#actionable-guide-next')?.addEventListener('click', () => {
      if (step === 1 && !selectedBotId && !customPrompt.trim()) {
        validationVisible = true;
        render();
        return;
      }
      if (step === 2) {
        if (selectedBotId) finish({ kind: 'start-practice', botId: selectedBotId });
        else finish({ kind: 'start-talk', customPrompt: customPrompt.trim() });
        return;
      }
      step += 1;
      render();
    });

    deactivate();
    deactivate = activateModalAccessibility(modal, {
      initialFocus: modal.querySelector<HTMLElement>('#actionable-guide-next'),
      restoreFocusTo: opener,
      onEscape: dismiss,
    });
  };

  render();
  modal.addEventListener('click', (event) => {
    if (event.target === modal) dismiss();
  });
}
