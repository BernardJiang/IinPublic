/** @jest-environment jsdom */

import { confirmCapturedQuestionDialog } from '../../web/ui/captured-question-dialog';

const t = (key: string): string => key;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('confirmCapturedQuestionDialog', () => {
  it('renders the question and every answer, escaped', () => {
    void confirmCapturedQuestionDialog({ question: '<b>Q</b>', answers: ['<i>A1</i>', 'A2'] }, t);
    const modal = document.getElementById('capture-question-confirm-modal')!;
    expect(modal.innerHTML).toContain('&lt;b&gt;Q&lt;/b&gt;');
    expect(modal.innerHTML).toContain('&lt;i&gt;A1&lt;/i&gt;');
    expect(modal.innerHTML).toContain('A2');
    expect(modal.innerHTML).not.toContain('<b>Q</b>');
  });

  it('resolves true and removes the modal when Accept is clicked', async () => {
    const promise = confirmCapturedQuestionDialog({ question: 'Q', answers: [] }, t);
    document
      .querySelector('[data-testid="capture-question-confirm-accept"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(true);
    expect(document.getElementById('capture-question-confirm-modal')).toBeNull();
  });

  it('resolves false and removes the modal when Decline is clicked', async () => {
    const promise = confirmCapturedQuestionDialog({ question: 'Q', answers: [] }, t);
    document
      .querySelector('[data-testid="capture-question-confirm-decline"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(false);
    expect(document.getElementById('capture-question-confirm-modal')).toBeNull();
  });

  it('resolves false when the backdrop itself is clicked', async () => {
    const promise = confirmCapturedQuestionDialog({ question: 'Q', answers: [] }, t);
    const modal = document.getElementById('capture-question-confirm-modal')!;
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(await promise).toBe(false);
  });

  it('does not resolve when a click lands inside the modal content, not the backdrop', () => {
    void confirmCapturedQuestionDialog({ question: 'Q', answers: [] }, t);
    const content = document.querySelector('.modal-content')!;
    content.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    // Still present — a content click must not bubble-resolve as a backdrop dismiss.
    expect(document.getElementById('capture-question-confirm-modal')).not.toBeNull();
  });

  it('removes a stale modal from a previous call before opening a new one', () => {
    void confirmCapturedQuestionDialog({ question: 'first', answers: [] }, t);
    void confirmCapturedQuestionDialog({ question: 'second', answers: [] }, t);
    expect(document.querySelectorAll('#capture-question-confirm-modal').length).toBe(1);
    expect(document.getElementById('capture-question-confirm-modal')!.innerHTML).toContain('second');
  });
});
