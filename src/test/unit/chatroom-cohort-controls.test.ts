/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
  bindCohortTraversalControls,
  renderCohortTraversalControls,
} from '../../web/ui/cohort-traversal-controls';
import {
  createLocalCohortTraversalViewModel,
  type CohortTraversalViewModel,
  type LocalCohortTraversalOutcome,
} from '../../web/ui/cohort-traversal-view-model';
import { uiText, type UiLanguage } from '../../web/ui/ui-translations';

function mount(viewModel: CohortTraversalViewModel, language: UiLanguage = 'en'): () => void {
  const rerender = (): void => {
    document.body.innerHTML = renderCohortTraversalControls(
      viewModel,
      (key) => uiText(language, key),
      (value) => value,
    );
    bindCohortTraversalControls(document, {
      viewModel,
      text: (key) => uiText(language, key),
      escapeHtml: (value) => value,
      rerender,
    });
  };
  rerender();
  return rerender;
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('Nearby visitable-cohort controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('explains the one-area, one-active-group model with accessible controls', () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4 });
    mount(model);

    const group = document.querySelector('[data-testid="cohort-controls"]');
    const meet = document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]');
    const returnDefault = document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]');
    const status = document.querySelector('[data-testid="cohort-status"]');

    expect(group).toHaveAttribute('role', 'group');
    expect(group).toHaveAttribute('aria-labelledby', 'chatroom-cohort-heading');
    expect(group).toHaveAttribute('aria-describedby', expect.stringContaining('chatroom-cohort-help'));
    expect(group).toHaveAttribute('aria-busy', 'false');
    expect(group?.textContent).toContain('4 groups share this area');
    expect(group?.textContent).toContain('without changing your Nearby area, map location, or location privacy');
    expect(group?.textContent).toContain('one group at a time');
    expect(meet).toBeEnabled();
    expect(returnDefault).toBeDisabled();
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveAttribute('aria-live', 'polite');
  });

  it('announces pending visits and enables return only after visiting another group', async () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4 });
    mount(model);

    document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')?.click();

    expect(document.querySelector('[data-testid="cohort-controls"]')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('[data-testid="cohort-status"]')?.textContent).toBe(
      'Moving to another group… Your location is unchanged.',
    );
    expect(document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')).toBeDisabled();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')).toBeDisabled();

    await settle();

    expect(document.querySelector('[data-testid="cohort-status"]')?.textContent).toBe(
      'You are visiting another group in the same area.',
    );
    expect(document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')).toBeEnabled();
  });

  it.each<[LocalCohortTraversalOutcome, string]>([
    ['full', 'That group is full. You stayed in your current group; try another.'],
    ['error', 'Could not switch groups. You remain in your current group; try again.'],
  ])('keeps the current group and permits another attempt after a %s outcome', async (outcome, message) => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4 });
    model.setNextOutcome(outcome);
    mount(model);

    document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')?.click();
    await settle();

    expect(document.querySelector('[data-testid="cohort-status"]')?.textContent).toBe(message);
    expect(document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')).toBeEnabled();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')).toBeDisabled();
  });

  it('disables switching while offline without disturbing the current group', () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4, online: false });
    mount(model);

    expect(document.querySelector('[data-testid="cohort-status"]')?.textContent).toBe(
      'Connect to switch groups. You remain in your current group.',
    );
    expect(document.querySelector<HTMLButtonElement>('[data-testid="meet-another-group-btn"]')).toBeDisabled();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')).toBeDisabled();
  });

  it('announces a return without presenting it as Return Home or map travel', async () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 4, isDefaultGroup: false });
    mount(model);

    document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')?.click();

    expect(document.querySelector('[data-testid="cohort-status"]')?.textContent).toBe(
      'Returning to your default group… Your location is unchanged.',
    );
    expect(document.body.textContent).not.toContain('Return Home');
    expect(document.body.textContent).not.toContain('Join as traveler');

    await settle();
    expect(document.querySelector<HTMLButtonElement>('[data-testid="return-default-group-btn"]')).toBeDisabled();
  });

  it('renders translated controls without protocol identifiers or coordinates', () => {
    const model = createLocalCohortTraversalViewModel({ groupCount: 7, isDefaultGroup: false });
    mount(model, 'zh');

    expect(document.body.textContent).toContain('这个区域有 7 个群组');
    expect(document.body.textContent).toContain('返回我的默认群组');
    expect(document.body.textContent).not.toMatch(/_part_\d+|nearby_v\d+|identity|[-+]?\d+\.\d+[°，,]\s*[-+]?\d+\.\d+/i);
  });
});
