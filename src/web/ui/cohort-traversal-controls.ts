import type { UiTranslationKey } from './ui-translations';
import {
  isCohortTraversalPending,
  type CohortTraversalSnapshot,
  type CohortTraversalViewModel,
} from './cohort-traversal-view-model';

type CohortTraversalControlsDeps = {
  viewModel: CohortTraversalViewModel;
  text: (key: UiTranslationKey) => string;
  escapeHtml: (text: string) => string;
  rerender: () => void;
};

const STATUS_TEXT: Record<Exclude<CohortTraversalSnapshot['status'], 'ready'>, UiTranslationKey> = {
  visiting: 'chatroomCohortVisiting',
  returning: 'chatroomCohortReturning',
  full: 'chatroomCohortFull',
  offline: 'chatroomCohortOffline',
  error: 'chatroomCohortError',
};

export function renderCohortTraversalControls(
  viewModel: CohortTraversalViewModel,
  text: (key: UiTranslationKey) => string,
  escapeHtml: (text: string) => string,
): string {
  const snapshot = viewModel.getSnapshot();
  const pending = isCohortTraversalPending(snapshot.status);
  const knownAlternates = (snapshot.groupCount ?? 1) > 1;
  const meetDisabled = pending || snapshot.status === 'offline' || !knownAlternates;
  const returnDisabled = pending || snapshot.status === 'offline' || snapshot.isDefaultGroup;
  const countText = snapshot.groupCount === undefined
    ? text('chatroomCohortCountUnknown')
    : text(snapshot.groupCount === 1 ? 'chatroomCohortCountOne' : 'chatroomCohortCountMany')
      .replace('{count}', String(snapshot.groupCount));
  const statusText = snapshot.status === 'ready'
    ? snapshot.isDefaultGroup
      ? knownAlternates ? text('chatroomCohortReady') : text('chatroomCohortOnlyGroup')
      : text('chatroomCohortVisitingReady')
    : text(STATUS_TEXT[snapshot.status]);

  return `
    <div class="chatroom-cohort-controls"
         data-testid="cohort-controls"
         role="group"
         aria-labelledby="chatroom-cohort-heading"
         aria-describedby="chatroom-cohort-help chatroom-cohort-status"
         aria-busy="${pending}">
      <div class="chatroom-cohort-copy">
        <h3 class="chatroom-cohort-heading" id="chatroom-cohort-heading">${escapeHtml(text('chatroomCohortHeading'))}</h3>
        <p class="chatroom-cohort-count" data-testid="cohort-count">${escapeHtml(countText)}</p>
        <p class="chatroom-cohort-help" id="chatroom-cohort-help">${escapeHtml(text('chatroomCohortSameAreaHelp'))}</p>
      </div>
      <div class="chatroom-cohort-actions">
        <button type="button"
                class="btn chatroom-cohort-primary"
                data-testid="meet-another-group-btn"
                aria-describedby="chatroom-cohort-help chatroom-cohort-status"
                ${meetDisabled ? 'disabled' : ''}>${escapeHtml(text('chatroomCohortMeetAnother'))}</button>
        <button type="button"
                class="btn btn-secondary"
                data-testid="return-default-group-btn"
                aria-describedby="chatroom-cohort-help chatroom-cohort-status"
                ${returnDisabled ? 'disabled' : ''}>${escapeHtml(text('chatroomCohortReturnDefault'))}</button>
      </div>
      <p class="chatroom-cohort-status chatroom-cohort-status-${snapshot.status}"
         id="chatroom-cohort-status"
         data-testid="cohort-status"
         role="status"
         aria-live="polite"
         aria-atomic="true">${escapeHtml(statusText)}</p>
    </div>`;
}

export function bindCohortTraversalControls(
  container: ParentNode,
  deps: CohortTraversalControlsDeps,
): void {
  const run = (operation: () => Promise<void>): void => {
    const completion = operation();
    // The view model enters its pending state synchronously. Paint it before awaiting the result.
    deps.rerender();
    void completion
      .catch(() => undefined)
      .finally(() => deps.rerender());
  };

  container.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')
    ?.addEventListener('click', () => run(() => deps.viewModel.meetAnotherGroup()));
  container.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')
    ?.addEventListener('click', () => run(() => deps.viewModel.returnToDefaultGroup()));
}
