/** @jest-environment jsdom */

import { showActionableOnboardingGuide } from '../../web/ui/actionable-onboarding-guide';

const text = (key: string, fallback?: string): string => fallback ?? key;

describe('actionable onboarding guide', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    document.getElementById('opener')?.focus();
  });

  it('opens the normal starter Talks inbox in one step', () => {
    const onFinish = jest.fn();
    showActionableOnboardingGuide({ text, onFinish, onShowProductTour: jest.fn() });

    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();

    expect(onFinish).toHaveBeenCalledWith({ kind: 'open-starter-talks' });
    expect(document.getElementById('actionable-guide-modal')).toBeNull();
  });

  it('hides while the optional product tour is open and resumes afterward', () => {
    let resume: (() => void) | undefined;
    showActionableOnboardingGuide({
      text,
      onFinish: jest.fn(),
      onShowProductTour: (callback) => { resume = callback; },
    });
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-product-tour"]')?.click();

    expect(document.getElementById('actionable-guide-modal')?.hidden).toBe(true);
    resume?.();
    expect(document.getElementById('actionable-guide-modal')?.hidden).toBe(false);
  });

  it('dismisses exactly once on Escape', () => {
    const onFinish = jest.fn();
    showActionableOnboardingGuide({ text, onFinish, onShowProductTour: jest.fn() });
    const modal = document.getElementById('actionable-guide-modal')!;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ kind: 'dismissed' });
    expect(document.activeElement).toBe(document.getElementById('opener'));
  });
});
