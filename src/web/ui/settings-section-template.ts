/**
 * A plain header, not a collapsible <details>/<summary>: the drill-down (see
 * applySettingsSectionView) shows exactly one section at a time, so a second, independent
 * collapse control on top of that would be redundant and just a way to accidentally hide
 * the only content on the page.
 */
export function renderSettingsSection(
  opts: { id?: string; title: string; subtitle?: string; action?: string; danger?: boolean },
  bodyHtml: string,
): string {
  return `
    <div class="settings-section" ${opts.id ? `id="${opts.id}"` : ''} style="background:var(--surface);border:1px solid ${opts.danger ? 'var(--danger-border)' : 'var(--border)'};border-radius:8px;">
      <div class="settings-section-summary" style="padding:16px;">
        <div style="font-weight:700;color:${opts.danger ? 'var(--danger-hover)' : 'var(--text-primary)'};display:inline;">${opts.title}</div>
        ${opts.subtitle ? `<div style="font-size:0.82em;color:var(--text-tertiary);margin-top:2px;">${opts.subtitle}</div>` : ''}
      </div>
      <div class="settings-section-body" style="padding:0 16px 16px 16px;">
        ${opts.action ? `<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">${opts.action}</div>` : ''}
        ${bodyHtml}
      </div>
    </div>
  `;
}
