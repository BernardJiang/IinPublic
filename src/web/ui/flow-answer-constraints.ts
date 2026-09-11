import type { UiTranslationKey } from './ui-translations';

export type FlowAnswerConstraintsDeps = {
  t: (key: UiTranslationKey) => string;
};

/** For flow talks, every answer but the first row must route to "ignore" — enforced via a tooltip, not a disabled control (Playwright/keyboard users must still be able to interact with every row). */
export function refreshFlowAnswerConstraints(type: string, deps: FlowAnswerConstraintsDeps): void {
  const questionItems = document.querySelectorAll('.question-item');
  questionItems.forEach((item) => {
    const answersContainer = item.querySelector('.answers-container');
    if (!answersContainer) return;
    const answerItems = answersContainer.querySelectorAll('.answer-item');
    answerItems.forEach((answerItem, aIdx) => {
      const select = answerItem.querySelector('.answer-next') as HTMLSelectElement | null;
      if (!select) return;
      // Always keep the select enabled so Playwright / keyboard users can
      // interact with every row. Reset any stale lock-state from previous
      // renders.
      select.disabled = false;
      const ignoreOpt = select.querySelector('option[value="ignore"]') as HTMLOptionElement | null;
      if (ignoreOpt) ignoreOpt.disabled = false;
      select.removeAttribute('title');
      if (type === 'flow' && aIdx > 0) {
        select.title = deps.t('editorFlowConstraint');
      }
    });
  });
}
