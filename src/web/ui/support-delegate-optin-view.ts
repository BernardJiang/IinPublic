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
  /** A verified invite TechSupport addressed to this identity (targeted, no code needed). */
  incomingInvite?: { expiresAt: number } | null;
  onRespondToInvite?: (accept: boolean) => Promise<'invalid' | 'expired' | 'unavailable' | null>;
  formatDate?: (date: Date) => string;
};

export function renderSupportDelegateOptInSection(deps: SupportDelegateOptInViewDeps): void {
  const container = document.getElementById('support-delegate-optin-section');
  if (!container) return;

  if (!deps.eligible) {
    const invite = deps.incomingInvite;
    const inviteCard = invite
      ? `
        <div data-testid="support-delegate-targeted-invite" style="padding:10px;border:1px solid var(--border);border-radius:8px;background:var(--bg-subtle);margin-bottom:12px;">
          <div style="font-weight:600;">${deps.text('supportDelegateTargetedInviteTitle')}</div>
          <div style="font-size:0.82em;color:var(--text-tertiary);margin:4px 0 8px;">${deps.text('supportDelegateTargetedInviteHelp')}${deps.formatDate ? ` · ${deps.escapeHtml(deps.formatDate(new Date(invite.expiresAt)))}` : ''}</div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn primary-btn" id="support-delegate-targeted-accept" data-testid="support-delegate-targeted-accept">${deps.text('supportDelegateTargetedInviteAccept')}</button>
            <button type="button" class="btn" id="support-delegate-targeted-decline" data-testid="support-delegate-targeted-decline">${deps.text('supportDelegateTargetedInviteDecline')}</button>
          </div>
        </div>`
      : '';
    container.innerHTML = renderSettingsSection(
      { title: deps.text('supportDelegateInviteEntryTitle'), subtitle: deps.text('supportDelegateInviteEntryHelp') },
      `${inviteCard}
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
    const respond = async (accept: boolean): Promise<void> => {
      container.querySelectorAll<HTMLButtonElement>('#support-delegate-targeted-accept, #support-delegate-targeted-decline')
        .forEach((b) => { b.disabled = true; });
      const err = await (deps.onRespondToInvite?.(accept) ?? Promise.resolve('unavailable' as const));
      // Query after the await: a successful response re-renders this section without the card.
      const status = container.querySelector('#support-delegate-invite-code-status') as HTMLElement | null;
      if (!status) return;
      if (err) {
        status.textContent = deps.text(err === 'expired' ? 'supportDelegateInviteErrorExpired' : 'supportDelegateInviteErrorUnavailable');
        container.querySelectorAll<HTMLButtonElement>('#support-delegate-targeted-accept, #support-delegate-targeted-decline')
          .forEach((b) => { b.disabled = false; });
      } else if (accept) {
        status.textContent = deps.text('supportDelegateInviteEntryPending');
      }
    };
    container.querySelector('#support-delegate-targeted-accept')?.addEventListener('click', () => void respond(true));
    container.querySelector('#support-delegate-targeted-decline')?.addEventListener('click', () => void respond(false));
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
