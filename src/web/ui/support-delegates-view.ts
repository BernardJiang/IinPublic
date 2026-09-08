import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import type { SupportFaqEntry } from '../../shared/techsupport-faq';
import type { UiTranslationKey } from './ui-translations';

/**
 * Master-only "Delegates" admin panel (docs/TODO.md K7, design note "Assigning an agent").
 * Rendered only inside a session authenticated as TECHSUPPORT_ROOT_USER_ID, alongside the
 * pending-question inbox (`support-inbox-view.ts`) — the operator-facing flow for turning
 * another account into a support agent without ever sharing the master key.
 */

export type SupportDelegatesViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, params: Record<string, string | number>) => string;
  formatDate: (date: Date) => string;
  onIssue: (input: { delegateUserId: string; label: string; ttlDays: number }) => void;
  onRevoke: (delegatePub: string) => void;
};

function grantStatus(grant: TechSupportDelegateGrant, deps: SupportDelegatesViewDeps): string {
  if (grant.revokedAt) return deps.text('supportDelegatesStatusRevoked');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) return deps.text('supportDelegatesStatusExpired');
  return deps.text('supportDelegatesStatusActive');
}

export function renderSupportDelegatesSection(
  deps: SupportDelegatesViewDeps,
  grants: readonly TechSupportDelegateGrant[],
  delegateActivity: readonly SupportFaqEntry[],
): void {
  const container = document.getElementById('support-delegates-section');
  if (!container) return;

  const sorted = [...grants].sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));

  container.innerHTML = `
    <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${deps.text('supportDelegatesTitle')}</div>
      <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:12px;">${deps.text('supportDelegatesHelp')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:14px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;flex:1;min-width:140px;">
          <span>${deps.text('supportDelegatesUserIdLabel')}</span>
          <input type="text" class="form-input" id="support-delegate-userid-input" data-testid="support-delegate-userid-input" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;flex:1;min-width:140px;">
          <span>${deps.text('supportDelegatesLabelLabel')}</span>
          <input type="text" class="form-input" id="support-delegate-label-input" data-testid="support-delegate-label-input" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;width:110px;">
          <span>${deps.text('supportDelegatesTtlLabel')}</span>
          <input type="number" class="form-input" id="support-delegate-ttl-input" data-testid="support-delegate-ttl-input" min="1" max="90" value="30" />
        </label>
        <button type="button" class="btn" id="support-delegate-issue-btn" data-testid="support-delegate-issue-btn">${deps.text('supportDelegatesIssue')}</button>
      </div>
      <div style="display:grid;gap:8px;margin-bottom:16px;">
        ${
          sorted.length === 0
            ? `<div style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('supportDelegatesEmpty')}</div>`
            : sorted
                .map((grant) => {
                  const status = grantStatus(grant, deps);
                  const canRevoke = !grant.revokedAt && new Date(grant.expiresAt).getTime() > Date.now();
                  return `
                    <div class="support-delegate-item" data-delegate-pub="${deps.escapeHtml(grant.delegatePub)}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-subtle);">
                      <div style="min-width:0;">
                        <div style="font-weight:600;">${deps.escapeHtml(grant.label || grant.delegateUserId)}</div>
                        <div style="font-size:0.76em;color:var(--text-tertiary);">${status} · ${deps.tf('supportDelegatesExpiresLabel', { date: deps.formatDate(new Date(grant.expiresAt)) })}</div>
                      </div>
                      ${canRevoke ? `<button type="button" class="btn support-delegate-revoke-btn" data-testid="support-delegate-revoke-btn">${deps.text('supportDelegatesRevoke')}</button>` : ''}
                    </div>
                  `;
                })
                .join('')
        }
      </div>
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${deps.text('supportDelegateActivityTitle')}</div>
      <div style="display:grid;gap:6px;">
        ${
          delegateActivity.length === 0
            ? `<div style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('supportDelegateActivityEmpty')}</div>`
            : delegateActivity
                .map(
                  (e) => `
                    <div style="padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.82em;">
                      <div>${deps.escapeHtml(e.canonicalQuestion)}</div>
                      <div style="color:var(--text-tertiary);">${deps.escapeHtml((e.answeredByDelegate || '').slice(0, 12))}… · ${deps.formatDate(new Date(e.answeredAt))}</div>
                    </div>
                  `,
                )
                .join('')
        }
      </div>
    </section>
  `;

  container.querySelector<HTMLButtonElement>('#support-delegate-issue-btn')?.addEventListener('click', () => {
    const delegateUserId = (document.getElementById('support-delegate-userid-input') as HTMLInputElement | null)?.value.trim() || '';
    const label = (document.getElementById('support-delegate-label-input') as HTMLInputElement | null)?.value.trim() || '';
    const ttlDays = Number((document.getElementById('support-delegate-ttl-input') as HTMLInputElement | null)?.value) || 30;
    if (!delegateUserId) return;
    deps.onIssue({ delegateUserId, label, ttlDays });
  });

  container.querySelectorAll<HTMLElement>('.support-delegate-item').forEach((item) => {
    const delegatePub = item.dataset.delegatePub || '';
    item.querySelector<HTMLButtonElement>('.support-delegate-revoke-btn')?.addEventListener('click', () => {
      if (delegatePub) deps.onRevoke(delegatePub);
    });
  });
}
