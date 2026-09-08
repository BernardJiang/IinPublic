import type { UiTranslationKey } from './ui-translations';

/**
 * An ordinary user's own opt-in toggle (docs/TODO.md K7, design note "Assigning an agent" step
 * 3): holding a valid delegate grant never silently turns on delegate mode — this section is how
 * the person explicitly accepts (or later turns back off) acting as a TechSupport delegate.
 */

export type SupportDelegateOptInViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  /** Operator-chosen label from the grant (e.g. "Alice's phone") — shown so the person recognizes which invitation this is. */
  label: string;
  optedIn: boolean;
  onToggle: (nextOptedIn: boolean) => void;
};

export function renderSupportDelegateOptInSection(deps: SupportDelegateOptInViewDeps): void {
  const container = document.getElementById('support-delegate-optin-section');
  if (!container) return;

  container.innerHTML = `
    <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${deps.text('supportDelegateOptInTitle')}${deps.label ? ` — ${deps.escapeHtml(deps.label)}` : ''}</div>
      <div style="font-size:0.85em;color:var(--text-tertiary);margin-bottom:10px;">${deps.text('supportDelegateOptInHelp')}</div>
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="support-delegate-optin-toggle" data-testid="support-delegate-optin-toggle" ${deps.optedIn ? 'checked' : ''} />
        <span>${deps.text('supportDelegateOptInToggleLabel')}</span>
      </label>
    </section>
  `;

  container.querySelector<HTMLInputElement>('#support-delegate-optin-toggle')?.addEventListener('change', (event) => {
    deps.onToggle((event.target as HTMLInputElement).checked);
  });
}
