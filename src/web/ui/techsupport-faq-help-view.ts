import { escapeHtml } from './ui-formatters';
import type { UiLanguage } from './ui-translations';
import { TECHSUPPORT_FAQ_SEED_TEMPLATES, isFaqSeedLocale, type FaqSeedLocale } from '../../shared/techsupport-faq-seed';

/**
 * Settings → Help's browsable FAQ list (docs/TODO.md K5, extending K2's compiled-content
 * pattern). Renders the exact same curated Q&A content that seeds TechSupport's DM auto-answer
 * bundle (`techsupport-faq-seed.ts`) — one authored source, two surfaces — so a user can look
 * something up directly instead of needing to DM TechSupport and hope their exact wording
 * matches. Works fully offline; no Gun, no signature check needed here (this is the app's own
 * compiled copy, the same trust level the first-run walkthrough's static text already has).
 */

function faqSeedLocale(language: UiLanguage): FaqSeedLocale {
  return isFaqSeedLocale(language) ? language : 'en';
}

export function renderTechSupportFaqHelpList(language: UiLanguage): string {
  const items = TECHSUPPORT_FAQ_SEED_TEMPLATES[faqSeedLocale(language)];
  return `
    <div class="settings-faq-list" data-testid="settings-faq-list">
      ${items
        .map(
          (item, index) => `
        <details class="settings-faq-item" data-testid="settings-faq-item-${index}" style="border:1px solid var(--border);border-radius:8px;margin-bottom:8px;">
          <summary style="cursor:pointer;padding:10px 12px;font-weight:600;" data-testid="settings-faq-question-${index}">${escapeHtml(item.question)}</summary>
          <div style="padding:0 12px 12px 12px;color:var(--text-secondary);font-size:0.9em;" data-testid="settings-faq-answer-${index}">${escapeHtml(item.answer)}</div>
        </details>`,
        )
        .join('')}
    </div>
  `;
}
