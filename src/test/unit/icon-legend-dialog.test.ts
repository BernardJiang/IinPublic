/** @jest-environment jsdom */
import { ICON_LEGEND, iconLegendHtml, showIconLegendDialog } from '../../web/ui/icon-legend-dialog';
import { uiText } from '../../web/ui/ui-translations';
import { escapeHtml } from '../../web/ui/ui-formatters';

describe('icon legend (OPEN-116 e)', () => {
  const keys = ICON_LEGEND.flatMap((section) => [section.titleKey, ...section.entries.map((entry) => entry.key)]);

  it('explains every row icon in English and Chinese', () => {
    for (const key of keys) {
      expect(uiText('en', key)).toBeTruthy();
      expect(uiText('zh', key)).toBeTruthy();
    }
    const icons = ICON_LEGEND.flatMap((section) => section.entries.map((entry) => entry.icon)).join(' ');
    for (const icon of ['♡', '👥', '#4', '📍', '📣', '📥', '🤖', '📋', '📌', '↑14 ↓10', '✉️', '🎚️']) {
      expect(icons).toContain(icon);
    }
  });

  it('renders one row per icon and closes on Close', () => {
    const html = iconLegendHtml((key) => uiText('en', key), escapeHtml);
    const rows = ICON_LEGEND.reduce((sum, section) => sum + section.entries.length, 0);
    expect(html.match(/data-testid="icon-legend-row"/g)).toHaveLength(rows);
    showIconLegendDialog({ text: (key) => uiText('en', key), escapeHtml });
    expect(document.querySelector('[data-testid="icon-legend-overlay"]')).not.toBeNull();
    (document.getElementById('icon-legend-close') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="icon-legend-overlay"]')).toBeNull();
  });
});
