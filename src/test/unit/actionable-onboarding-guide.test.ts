/** @jest-environment jsdom */

import { showActionableOnboardingGuide } from '../../web/ui/actionable-onboarding-guide';
import { STARTER_PRACTICE_BOTS } from '../../web/ui/starter-practice-bots';

const text = (key: string, fallback?: string): string => fallback ?? key;

describe('actionable onboarding guide', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    document.getElementById('opener')?.focus();
  });

  it('requires a choice and returns a practice bot without contacting anyone', () => {
    const onFinish = jest.fn();
    showActionableOnboardingGuide({
      text,
      language: 'en',
      onFinish,
      onShowProductTour: jest.fn(),
    });

    expect(document.querySelectorAll('.actionable-starter-card')).toHaveLength(0);
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    expect(document.querySelectorAll('.actionable-starter-card')).toHaveLength(STARTER_PRACTICE_BOTS.length);

    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    expect(document.getElementById('actionable-guide-error')?.hasAttribute('hidden')).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-starter-echo"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    expect(document.querySelector('[data-testid="actionable-choice-preview"]')?.textContent).toBe('echo');
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();

    expect(onFinish).toHaveBeenCalledWith({ kind: 'start-practice', botId: 'echo' });
    expect(document.getElementById('actionable-guide-modal')).toBeNull();
  });

  it('keeps a custom prompt while the optional product tour opens and resumes', () => {
    const onFinish = jest.fn();
    let resume: (() => void) | undefined;
    showActionableOnboardingGuide({
      text,
      language: 'zh',
      onFinish,
      onShowProductTour: (callback) => { resume = callback; },
    });
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    const input = document.querySelector<HTMLTextAreaElement>('[data-testid="actionable-custom-prompt"]')!;
    input.value = '一起练习中文吗？';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-product-tour"]')?.click();

    expect(document.getElementById('actionable-guide-modal')?.hidden).toBe(true);
    resume?.();
    expect(document.getElementById('actionable-guide-modal')?.hidden).toBe(false);
    expect(document.querySelector('[data-testid="actionable-choice-preview"]')?.textContent).toBe('一起练习中文吗？');
    document.querySelector<HTMLButtonElement>('[data-testid="actionable-guide-next"]')?.click();
    expect(onFinish).toHaveBeenCalledWith({ kind: 'start-talk', customPrompt: '一起练习中文吗？' });
  });

  it('dismisses exactly once on Escape', () => {
    const onFinish = jest.fn();
    showActionableOnboardingGuide({ text, language: 'en', onFinish, onShowProductTour: jest.fn() });
    const modal = document.getElementById('actionable-guide-modal')!;
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({ kind: 'dismissed' });
    expect(document.activeElement).toBe(document.getElementById('opener'));
  });
});
