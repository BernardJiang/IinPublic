/** @jest-environment jsdom */

import { showWalkthroughDialog } from '../../web/ui/onboarding-walkthrough';

const text = (_key: string, fallback?: string): string => fallback ?? _key;

describe('onboarding walkthrough', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    document.getElementById('opener')?.focus();
  });

  it('opens with the digital-you promise and simple slide navigation', () => {
    showWalkthroughDialog({ text, onClose: jest.fn() });

    expect(document.querySelector('[data-testid="walkthrough-step-0"]')?.textContent)
      .toContain('Build your digital you');
    expect(document.querySelector('[data-testid="walkthrough-tagline"]')?.textContent)
      .toBe('Say it once. Let your digital you repeat it.');
    expect(document.querySelector('[data-testid="walkthrough-step-0"]')?.textContent)
      .toContain('Ask or answer once');
    expect(document.querySelector('[data-testid="walkthrough-step-0"]')?.textContent)
      .toContain('automatically reuse');
    expect(document.querySelector('[data-testid="walkthrough-step-0"]')?.textContent)
      .toContain("handle what's new");
    expect(document.querySelector('[data-testid="walkthrough-skip-btn"]')).toBeNull();
    expect(document.querySelector('[data-testid="walkthrough-back-btn"]')).toBeNull();

    document.querySelector<HTMLButtonElement>('[data-testid="walkthrough-next-btn"]')?.click();

    expect(document.querySelector('[data-testid="walkthrough-step-1"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="walkthrough-step-1"]')?.textContent)
      .toContain('Broadcast your Talks');
    expect(document.querySelector('[data-testid="walkthrough-step-1"]')?.textContent)
      .toContain("Receive others' Talks");
    expect(document.querySelector('[data-testid="walkthrough-back-btn"]')).not.toBeNull();
  });

  it('follows navigation order and explains asking and answering in Talks', () => {
    showWalkthroughDialog({ text, onClose: jest.fn() });

    document.querySelector<HTMLButtonElement>('[data-testid="walkthrough-dot-2"]')?.click();
    expect(document.querySelector('[data-testid="walkthrough-step-2"]')?.textContent)
      .toContain('Contacts');

    document.querySelector<HTMLButtonElement>('[data-testid="walkthrough-next-btn"]')?.click();
    const talksSlide = document.querySelector('[data-testid="walkthrough-step-3"]');
    expect(talksSlide?.textContent).toContain('Talks');
    expect(talksSlide?.textContent).toContain('Create questions for your digital you to ask on your behalf.');
    expect(talksSlide?.textContent).toContain('Create and answer questions in one place');
    expect(talksSlide?.textContent).toContain('Answer your own questions to share what you think.');
    expect(talksSlide?.textContent).toContain('Respond to questions you receive from others.');
  });

  it('uses the close icon as the only early exit and restores focus', () => {
    const onClose = jest.fn();
    showWalkthroughDialog({ text, onClose });

    document.querySelector<HTMLButtonElement>('[data-testid="walkthrough-close-btn"]')?.click();

    expect(document.getElementById('walkthrough-modal')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.getElementById('opener'));
  });
});
