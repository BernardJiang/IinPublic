import type { SupportInboxEntry } from '../../shared/techsupport-faq';
import type { UiTranslationKey } from './ui-translations';
import { renderSettingsSection } from './settings-section-template';

/**
 * TechSupport support-inbox section (docs/TODO.md K5, design note §Item 4).
 *
 * Visible only inside a session authenticated as TECHSUPPORT_ROOT_USER_ID (gated by the caller,
 * ui-manager.ts's `renderSettingsView`) — an operator tool, not a per-user surface. Read-only
 * list of pending questions, with an inline answer form per row (§Item 5): the operator can edit
 * the question text before it is published (privacy — never promote the asker's personal detail
 * verbatim), plus the answer, then submits both in one action.
 */

export type SupportInboxViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  formatDate: (date: Date) => string;
  onAnswer: (input: {
    questionKey: string;
    question: string;
    answer: string;
    conversationId: string;
    askedBy: string;
  }) => void;
};

/**
 * Captures whatever an operator has typed into each row's question/answer fields (and which one,
 * if any, currently has focus) before a re-render blows the whole subtree away. This view
 * re-renders on every mailbox-poll/live-update tick regardless of whether anything actually
 * changed (subscribeToSupportInboxIfTechSupport re-ingests the same still-pending question
 * repeatedly) — a full `innerHTML` replace mid-keystroke silently discarded an operator's
 * in-progress answer with no error, confirmed live 2026-09-24 answering a real question from a
 * real Huawei phone ("it just automatically disappeared while I was typing"). Restored after the
 * new HTML is built, keyed by questionKey so it survives even when row order/count changes.
 */
function captureInFlightEdits(container: HTMLElement): Map<string, { question?: string; answer?: string; focus?: 'question' | 'answer' }> {
  const captured = new Map<string, { question?: string; answer?: string; focus?: 'question' | 'answer' }>();
  container.querySelectorAll<HTMLElement>('.support-inbox-item').forEach((item) => {
    const questionKey = item.dataset.questionKey || '';
    if (!questionKey) return;
    const questionInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-question-input');
    const answerInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    const active = document.activeElement;
    const entry: { question?: string; answer?: string; focus?: 'question' | 'answer' } = {};
    if (questionInput) entry.question = questionInput.value;
    if (answerInput) entry.answer = answerInput.value;
    if (active === questionInput) entry.focus = 'question';
    else if (active === answerInput) entry.focus = 'answer';
    if (entry.question !== undefined || entry.answer !== undefined) captured.set(questionKey, entry);
  });
  return captured;
}

function restoreInFlightEdits(container: HTMLElement, captured: Map<string, { question?: string; answer?: string; focus?: 'question' | 'answer' }>): void {
  container.querySelectorAll<HTMLElement>('.support-inbox-item').forEach((item) => {
    const questionKey = item.dataset.questionKey || '';
    const saved = captured.get(questionKey);
    if (!saved) return;
    const questionInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-question-input');
    const answerInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    if (saved.question !== undefined && questionInput) questionInput.value = saved.question;
    if (saved.answer !== undefined && answerInput) answerInput.value = saved.answer;
    if (saved.focus === 'question') questionInput?.focus();
    else if (saved.focus === 'answer') answerInput?.focus();
  });
}

export function renderSupportInboxSection(deps: SupportInboxViewDeps, entries: readonly SupportInboxEntry[]): void {
  const container = document.getElementById('support-inbox-section');
  if (!container) return;

  const pending = entries.filter((entry) => entry.status === 'pending');
  const inFlightEdits = captureInFlightEdits(container);

  if (pending.length === 0) {
    container.innerHTML = renderSettingsSection(
      { title: deps.text('supportInboxTitle') },
      `<div style="font-size:0.88em;color:var(--text-tertiary);">${deps.text('supportInboxEmpty')}</div>`,
    );
    return;
  }

  container.innerHTML = renderSettingsSection(
    { title: `${deps.text('supportInboxTitle')} (${pending.length})` },
    `
      <div style="display:grid;gap:12px;">
        ${pending
          .map((entry) => {
            const askedAt = entry.askedAt ? deps.formatDate(new Date(entry.askedAt)) : '';
            return `
              <div class="support-inbox-item" data-question-key="${deps.escapeHtml(entry.questionKey)}" data-conversation-id="${deps.escapeHtml(entry.conversationId)}" data-asked-by="${deps.escapeHtml(entry.askedBy)}" style="padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);">
                <div style="font-size:0.78em;color:var(--text-tertiary);margin-bottom:6px;">${askedAt}</div>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:0.88em;margin-bottom:8px;">
                  <span>${deps.text('supportInboxQuestionLabel')}</span>
                  <textarea class="form-input support-inbox-question-input" rows="2">${deps.escapeHtml(entry.question)}</textarea>
                </label>
                <div style="font-size:0.76em;color:var(--warning-text,#8a6d00);margin-bottom:8px;">${deps.text('supportInboxPrivacyWarning')}</div>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:0.88em;margin-bottom:8px;">
                  <span>${deps.text('supportInboxAnswerLabel')}</span>
                  <textarea class="form-input support-inbox-answer-input" rows="3"></textarea>
                </label>
                <button type="button" class="btn support-inbox-answer-btn" data-testid="support-inbox-answer-btn">${deps.text('supportInboxAnswerPublish')}</button>
              </div>
            `;
          })
          .join('')}
      </div>
    `,
  );

  container.querySelectorAll<HTMLElement>('.support-inbox-item').forEach((item) => {
    const questionKey = item.dataset.questionKey || '';
    const conversationId = item.dataset.conversationId || '';
    const askedBy = item.dataset.askedBy || '';
    const questionInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-question-input');
    const answerInput = item.querySelector<HTMLTextAreaElement>('.support-inbox-answer-input');
    const answerBtn = item.querySelector<HTMLButtonElement>('.support-inbox-answer-btn');
    answerBtn?.addEventListener('click', () => {
      const question = questionInput?.value.trim() || '';
      const answer = answerInput?.value.trim() || '';
      if (!question || !answer) return;
      deps.onAnswer({ questionKey, question, answer, conversationId, askedBy });
    });
  });

  restoreInFlightEdits(container, inFlightEdits);
}
