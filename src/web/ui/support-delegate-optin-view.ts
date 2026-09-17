import type { UiTranslationKey } from './ui-translations';
import { renderSettingsSection } from './settings-section-template';

/**
 * An ordinary user's own delegate settings section (docs/TODO.md K7, design note "Assigning an
 * agent" step 3; invite-code entry is a K7 follow-on — see `techsupport-delegate-invite.ts`).
 *
 * Two states, same container:
 *  - Not yet eligible (no valid grant): shows an "enter invite code" form — a would-be delegate
 *    who received a code from the master sends a signed request here.
 *  - Eligible (holds a valid grant): shows the explicit opt-in toggle. Holding a grant never
 *    silently turns on delegate mode — the person must accept it here.
 */

export type SupportDelegateOptInViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  eligible: boolean;
  /** Operator-chosen label from the grant (e.g. "Alice's phone") — shown so the person recognizes which invitation this is. */
  label: string;
  optedIn: boolean;
  onToggle: (nextOptedIn: boolean) => void;
  onSubmitInviteCode: (code: string) => Promise<'invalid' | 'expired' | 'unavailable' | null>;
};

export function renderSupportDelegateOptInSection(deps: SupportDelegateOptInViewDeps): void {
  const container = document.getElementById('support-delegate-optin-section');
  if (!container) return;

  if (!deps.eligible) {
    container.innerHTML = renderSettingsSection(
      { title: deps.text('supportDelegateInviteEntryTitle'), subtitle: deps.text('supportDelegateInviteEntryHelp') },
      `
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;">
          <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;flex:1;min-width:160px;">
            <span>${deps.text('supportDelegatesInvite')}</span>
            <input type="text" class="form-input" id="support-delegate-invite-code-input" data-testid="support-delegate-invite-code-input" autocomplete="off" />
          </label>
          <button type="button" class="btn primary-btn" id="support-delegate-invite-code-submit" data-testid="support-delegate-invite-code-submit">${deps.text('supportDelegateInviteEntrySubmit')}</button>
        </div>
        <div id="support-delegate-invite-code-status" data-testid="support-delegate-invite-code-status" role="status" style="font-size:0.82em;color:var(--text-tertiary);min-height:1em;margin-top:6px;"></div>
      `,
    );
    const submit = async (): Promise<void> => {
      const input = container.querySelector('#support-delegate-invite-code-input') as HTMLInputElement | null;
      const status = container.querySelector('#support-delegate-invite-code-status') as HTMLElement | null;
      const code = input?.value.trim() || '';
      if (!code || !status) return;
      const err = await deps.onSubmitInviteCode(code);
      const errorText: Record<'invalid' | 'expired' | 'unavailable', string> = {
        invalid: deps.text('supportDelegateInviteErrorInvalid'),
        expired: deps.text('supportDelegateInviteErrorExpired'),
        unavailable: deps.text('supportDelegateInviteErrorUnavailable'),
      };
      status.textContent = err ? errorText[err] : deps.text('supportDelegateInviteEntryPending');
      if (!err && input) input.value = '';
    };
    container.querySelector('#support-delegate-invite-code-submit')?.addEventListener('click', () => void submit());
    return;
  }

  container.innerHTML = renderSettingsSection(
    {
      title: `${deps.text('supportDelegateOptInTitle')}${deps.label ? ` — ${deps.escapeHtml(deps.label)}` : ''}`,
      subtitle: deps.text('supportDelegateOptInHelp'),
    },
    `
      <label style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="support-delegate-optin-toggle" data-testid="support-delegate-optin-toggle" ${deps.optedIn ? 'checked' : ''} />
        <span>${deps.text('supportDelegateOptInToggleLabel')}</span>
      </label>
    `,
  );

  container.querySelector<HTMLInputElement>('#support-delegate-optin-toggle')?.addEventListener('change', (event) => {
    deps.onToggle((event.target as HTMLInputElement).checked);
  });
}
