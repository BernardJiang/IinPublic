import type { SupportInboxEntry } from '../../shared/techsupport-faq';
import type { UiTranslationKey } from './ui-translations';

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

export function renderSupportInboxSection(deps: SupportInboxViewDeps, entries: readonly SupportInboxEntry[]): void {
  const container = document.getElementById('support-inbox-section');
  if (!container) return;

  const pending = entries.filter((entry) => entry.status === 'pending');

  if (pending.length === 0) {
    container.innerHTML = `
      <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${deps.text('supportInboxTitle')}</div>
        <div style="font-size:0.88em;color:var(--text-tertiary);">${deps.text('supportInboxEmpty')}</div>
      </section>
    `;
    return;
  }

  container.innerHTML = `
    <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${deps.text('supportInboxTitle')} (${pending.length})</div>
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
    </section>
  `;

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
}
