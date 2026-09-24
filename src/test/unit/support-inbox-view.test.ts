/** @jest-environment jsdom */

import { renderSupportInboxSection, type SupportInboxViewDeps } from '../../web/ui/support-inbox-view';
import type { SupportInboxEntry } from '../../shared/techsupport-faq';

/**
 * Regression coverage for a real bug found live 2026-09-24, answering a real question from a
 * real Huawei phone: this section re-renders (a full innerHTML replace) on every mailbox-poll/
 * live-update tick, even when nothing about the pending list actually changed — an operator
 * mid-typing an answer had it silently wiped with no error ("it just automatically disappeared
 * while I was typing").
 */

function deps(onAnswer: SupportInboxViewDeps['onAnswer'] = () => {}): SupportInboxViewDeps {
  return {
    escapeHtml: (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)),
    text: (key) => key,
    formatDate: (date) => date.toISOString(),
    onAnswer,
  };
}

function entry(overrides: Partial<SupportInboxEntry> = {}): SupportInboxEntry {
  return {
    questionKey: 'q1',
    question: 'Why does it break?',
    askedBy: 'asker-1',
    conversationId: 'conv-1',
    askedAt: '2026-09-24T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

beforeEach(() => {
  document.body.innerHTML = '<div id="support-inbox-section"></div>';
});

describe('renderSupportInboxSection', () => {
  it('does nothing when the container is absent', () => {
    document.body.innerHTML = '';
    expect(() => renderSupportInboxSection(deps(), [entry()])).not.toThrow();
  });

  it('renders one row per pending entry and skips answered ones', () => {
    renderSupportInboxSection(deps(), [entry(), entry({ questionKey: 'q2', status: 'answered' })]);
    const items = document.querySelectorAll('.support-inbox-item');
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('data-question-key')).toBe('q1');
  });

  it('preserves an in-progress answer draft across a re-render for the same still-pending question', () => {
    renderSupportInboxSection(deps(), [entry()]);
    const answerInput = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    expect(answerInput).not.toBeNull();
    answerInput!.value = 'answer 2';

    // Simulate the mailbox poll re-ingesting the exact same still-pending entry and re-rendering.
    renderSupportInboxSection(deps(), [entry()]);

    const answerInputAfter = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    expect(answerInputAfter).not.toBeNull();
    expect(answerInputAfter!.value).toBe('answer 2');
  });

  it('preserves an edited question draft the same way', () => {
    renderSupportInboxSection(deps(), [entry()]);
    const questionInput = document.querySelector<HTMLTextAreaElement>('.support-inbox-question-input');
    questionInput!.value = 'Edited question text';

    renderSupportInboxSection(deps(), [entry()]);

    const questionInputAfter = document.querySelector<HTMLTextAreaElement>('.support-inbox-question-input');
    expect(questionInputAfter!.value).toBe('Edited question text');
  });

  it('restores focus to the answer field the operator was actively typing into', () => {
    renderSupportInboxSection(deps(), [entry()]);
    const answerInput = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    answerInput!.focus();
    expect(document.activeElement).toBe(answerInput);

    renderSupportInboxSection(deps(), [entry()]);

    const answerInputAfter = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    expect(document.activeElement).toBe(answerInputAfter);
  });

  it('does not leak a draft onto an unrelated question with a different key', () => {
    renderSupportInboxSection(deps(), [entry({ questionKey: 'q1' })]);
    const answerInput = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    answerInput!.value = 'for q1 only';

    renderSupportInboxSection(deps(), [entry({ questionKey: 'q2', question: 'A different question' })]);

    const answerInputAfter = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    expect(answerInputAfter!.value).toBe('');
  });

  it('still submits the preserved draft correctly on click', () => {
    const onAnswer = jest.fn();
    renderSupportInboxSection(deps(onAnswer), [entry()]);
    const answerInput = document.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    answerInput!.value = 'answer 2';

    // Re-render happens (e.g. a poll tick) before the operator clicks submit.
    renderSupportInboxSection(deps(onAnswer), [entry()]);

    document.querySelector<HTMLButtonElement>('.support-inbox-answer-btn')!.click();
    expect(onAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ questionKey: 'q1', answer: 'answer 2', question: 'Why does it break?' }),
    );
  });
});
