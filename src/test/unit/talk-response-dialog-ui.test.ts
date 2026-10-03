/** @jest-environment jsdom */

import { showTalkResponseDialog } from '../../web/ui/talk-response-dialog';

function talk() {
  return {
    id: 'talk-1',
    authorId: 'sender-1',
    title: 'Meet for coffee?',
    type: 'flow',
    language: 'en',
    questions: [{
      id: 'q1',
      text: 'Would you like to meet for coffee?',
      answers: [
        { id: 'yes', text: 'Yes', isMatch: true, isTerminal: true },
        { id: 'later', text: 'Not now', isIgnore: true, isTerminal: true },
      ],
    }],
  };
}

function deps(overrides: Record<string, unknown> = {}) {
  return {
    talk: talk(),
    skipAutoAnswer: true,
    escapeHtml: (value: string) => value,
    showNotification: jest.fn(),
    completeTalk: jest.fn(),
    resolveAnswerPreferenceForTalkQuestion: jest.fn(() => null),
    saveAnswerPreference: jest.fn(() => 'context-hash'),
    ...overrides,
  } as Parameters<typeof showTalkResponseDialog>[0];
}

describe('talk response dialog answer controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('shows only Auto and Manual for each answer and separates receiver Ignore', () => {
    const options = deps({ canIgnore: true, autoAnswerMode: 'whenever' });
    showTalkResponseDialog(options);

    const modal = document.getElementById('talk-response-modal')!;
    expect(modal.querySelector('.answer-grid-header')?.textContent).toContain('Answer');
    expect(modal.querySelector('.answer-grid-header')?.textContent).toContain('Auto');
    expect(modal.querySelector('.answer-grid-header')?.textContent).toContain('Manual');
    expect(modal.querySelectorAll('input.choice-radio')).toHaveLength(4);
    expect(modal.querySelectorAll('input.choice-radio[data-mode="whenever"]')).toHaveLength(2);
    expect(modal.querySelector('.answer-radio-grid')?.textContent).not.toContain('Whenever offered');
    expect(modal.querySelector('.answer-radio-grid')?.textContent).not.toContain('Same context');
    expect(modal.querySelector('.response-question-row [data-testid="receiver-ignore-btn"]')).not.toBeNull();

    (modal.querySelector('[data-testid="receiver-ignore-btn"]') as HTMLButtonElement).click();
    expect(options.saveAnswerPreference).toHaveBeenCalledWith(
      expect.anything(), 'talk-1', expect.anything(), 'ignore', 'ignore', expect.anything(), 'suppressed',
    );
    expect(options.completeTalk).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'mismatch', { withholdFromSender: true },
    );
  });

  it('does not offer the receiver Ignore action to the Talk author', () => {
    showTalkResponseDialog(deps({ canIgnore: false }));
    expect(document.querySelector('[data-testid="receiver-ignore-btn"]')).toBeNull();
  });

  it('maps the visible Auto choice to the global internal scope', () => {
    const options = deps({ canIgnore: true, autoAnswerMode: 'whenever' });
    showTalkResponseDialog(options);

    (document.querySelector('input.choice-radio[data-answer-id="yes"][data-mode="whenever"]') as HTMLInputElement).click();

    expect(options.saveAnswerPreference).toHaveBeenCalledWith(
      expect.anything(), 'talk-1', expect.anything(), 'yes', 'Yes', expect.anything(), 'whenever',
    );
  });
});
