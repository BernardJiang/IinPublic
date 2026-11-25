import { activateModalAccessibility } from './modal-accessibility';
import type { UiTranslationKey } from './ui-translations';

/**
 * "What the icons mean" (OPEN-116 e): every small icon on the Nearby, Contacts, Talks and Me rows,
 * explained in one list. Phones have no hover, so a row icon's `title` alone explains nothing.
 * Opened from the AppBar (ℹ️), never from a button inside a view.
 */
export type IconLegendEntry = { icon: string; key: UiTranslationKey };
export type IconLegendSection = { titleKey: UiTranslationKey; entries: IconLegendEntry[] };

export const ICON_LEGEND: readonly IconLegendSection[] = [
  {
    titleKey: 'iconLegendStatusLine',
    entries: [
      { icon: '👥 4', key: 'iconLegendStatusPeople' },
      { icon: '💬 30', key: 'iconLegendStatusTalks' },
      { icon: '✍️ 30', key: 'iconLegendStatusAnswered' },
      { icon: '🟢', key: 'iconLegendOnline' },
    ],
  },
  {
    titleKey: 'iconLegendTagRows',
    entries: [
      { icon: '♡', key: 'iconLegendLiked' },
      { icon: '👥 3', key: 'iconLegendPeople' },
      { icon: '#4', key: 'iconLegendRank' },
      { icon: '✕ 2', key: 'iconLegendPassCount' },
      { icon: '📍 Nearby', key: 'iconLegendPlace' },
      { icon: '💬 1', key: 'iconLegendAskedBy' },
      { icon: '☑ 📣', key: 'iconLegendPublic' },
      { icon: '✕', key: 'iconLegendRowPass' },
    ],
  },
  {
    titleKey: 'iconLegendTalkRows',
    entries: [
      { icon: '🏷️ ➡️ 📊 🔀', key: 'iconLegendTypes' },
      { icon: '📥', key: 'iconLegendReceived' },
      { icon: '👤 1', key: 'iconLegendSenders' },
      { icon: 'Q1/2', key: 'iconLegendQuestionProgress' },
      { icon: '🤖', key: 'iconLegendChatbot' },
      { icon: '📋', key: 'iconLegendCopy' },
      { icon: '📌', key: 'iconLegendPinned' },
    ],
  },
  {
    titleKey: 'iconLegendPeopleRows',
    entries: [
      { icon: '↑14 ↓10', key: 'iconLegendTraffic' },
      { icon: '🏷️ 14', key: 'iconLegendInCommon' },
      { icon: '30%', key: 'iconLegendAlike' },
      { icon: '#1', key: 'iconLegendMostAlike' },
      { icon: '✈', key: 'iconLegendTraveler' },
    ],
  },
  {
    titleKey: 'iconLegendTopBar',
    entries: [
      { icon: '✉️', key: 'iconLegendMessages' },
      { icon: '🎚️', key: 'iconLegendPreferences' },
      { icon: '✕ ♡ 📌', key: 'iconLegendSelection' },
    ],
  },
];

export function iconLegendHtml(text: (key: UiTranslationKey) => string, escapeHtml: (value: string) => string): string {
  return ICON_LEGEND.map((section) => `
    <section class="icon-legend-section">
      <h4 class="icon-legend-heading">${escapeHtml(text(section.titleKey))}</h4>
      <dl class="icon-legend-list">
        ${section.entries.map((entry) => `
          <div class="icon-legend-row" data-testid="icon-legend-row">
            <dt class="icon-legend-icon">${escapeHtml(entry.icon)}</dt>
            <dd class="icon-legend-meaning">${escapeHtml(text(entry.key))}</dd>
          </div>`).join('')}
      </dl>
    </section>`).join('');
}

export function showIconLegendDialog(deps: { text: (key: UiTranslationKey) => string; escapeHtml: (value: string) => string }): void {
  document.getElementById('icon-legend-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'icon-legend-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'icon-legend-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-m" role="dialog" aria-modal="true" aria-labelledby="icon-legend-title">
      <div class="modal-header"><h3 class="modal-title" id="icon-legend-title">${deps.escapeHtml(deps.text('iconLegendTitle'))}</h3></div>
      <div class="icon-legend-body" style="max-height:65vh;overflow:auto;">${iconLegendHtml(deps.text, deps.escapeHtml)}</div>
      <div class="modal-actions">
        <button type="button" class="btn primary-btn" id="icon-legend-close" data-testid="icon-legend-close">${deps.escapeHtml(deps.text('iconLegendClose'))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  let deactivate = (): void => {};
  const close = (): void => {
    deactivate();
    overlay.remove();
  };
  overlay.querySelector('#icon-legend-close')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
  deactivate = activateModalAccessibility(overlay, {
    initialFocus: overlay.querySelector<HTMLElement>('#icon-legend-close'),
    restoreFocusTo: opener,
    onEscape: close,
  });
}
