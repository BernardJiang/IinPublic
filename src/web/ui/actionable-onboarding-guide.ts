import { activateModalAccessibility } from './modal-accessibility';
import { escapeHtml } from './ui-formatters';

export type ActionableGuideResult =
  | { kind: 'dismissed' }
  | { kind: 'open-starter-talks' };

export interface ActionableOnboardingGuideDeps {
  text: (key: string, fallback?: string) => string;
  onFinish: (result: ActionableGuideResult) => void;
  /** Temporarily hides this guide while the reference tour is open, then resumes it. */
  onShowProductTour: (resume: () => void) => void;
}

/** A short handoff into the real starter-Talk queue; no tutorial-only bot concept. */
export function showActionableOnboardingGuide(deps: ActionableOnboardingGuideDeps): void {
  document.getElementById('actionable-guide-modal')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const modal = document.createElement('div');
  modal.id = 'actionable-guide-modal';
  modal.className = 'modal-overlay actionable-guide-overlay';
  modal.dataset.testid = 'actionable-guide-modal';
  document.body.appendChild(modal);

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

  const render = (): void => {
    modal.innerHTML = `
      <div class="modal-content size-m actionable-guide-card" role="dialog" aria-modal="true" aria-labelledby="actionable-guide-title" aria-describedby="actionable-guide-description">
        <div class="modal-header actionable-guide-header">
          <span></span>
          <button type="button" class="close-button" id="actionable-guide-close" data-testid="actionable-guide-close" aria-label="${escapeHtml(deps.text('actionGuideSkip', 'Skip for now'))}">&times;</button>
        </div>
        <div class="actionable-guide-content">
          <div class="actionable-guide-hero">
            <div class="actionable-guide-icon" aria-hidden="true">💬</div>
            <h2 id="actionable-guide-title">${escapeHtml(deps.text('actionGuideWelcomeTitle', 'A few starter Talks are waiting for you.'))}</h2>
            <p id="actionable-guide-description">${escapeHtml(deps.text('actionGuideWelcomeBody', 'Use the ones that fit and drop the rest. Each choice teaches IinPublic what belongs in your bot.'))}</p>
          </div>
        </div>
        <div class="modal-actions actionable-guide-actions">
          <button type="button" class="btn" id="actionable-guide-skip" data-testid="actionable-guide-skip">${escapeHtml(deps.text('actionGuideSkip', 'Skip for now'))}</button>
          <div class="actionable-guide-forward-actions">
            <button type="button" class="btn" id="actionable-guide-product-tour" data-testid="actionable-guide-product-tour">${escapeHtml(deps.text('actionGuideHowItWorks', 'See how IinPublic works'))}</button>
            <button type="button" class="btn primary-btn" id="actionable-guide-next" data-testid="actionable-guide-next">${escapeHtml(deps.text('actionGuideReview', 'Review starter Talks'))}</button>
          </div>
        </div>
      </div>`;

    modal.querySelector('#actionable-guide-close')?.addEventListener('click', dismiss);
    modal.querySelector('#actionable-guide-skip')?.addEventListener('click', dismiss);
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
    modal.querySelector('#actionable-guide-next')?.addEventListener('click', () => finish({ kind: 'open-starter-talks' }));

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
