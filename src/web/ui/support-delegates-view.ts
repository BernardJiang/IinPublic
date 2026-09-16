import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';
import type { TechSupportDelegateRequest, DelegateInvitePayload } from '../../shared/techsupport-delegate-invite';
import type { SupportFaqEntry } from '../../shared/techsupport-faq';
import type { UiTranslationKey } from './ui-translations';
import { formatIdentityFingerprint } from '../services/local-device-metadata';
import { renderLinkCodeQr } from './link-code-qr';

/**
 * Master-only "Delegates" admin panel (docs/TODO.md K7, design note "Assigning an agent";
 * invite-code handshake is a K7 follow-on — see `techsupport-delegate-invite.ts`). Rendered only
 * inside a session authenticated as TECHSUPPORT_ROOT_USER_ID, alongside the pending-question
 * inbox (`support-inbox-view.ts`) — the operator-facing flow for turning another account into a
 * support agent without ever sharing the master key.
 *
 * Issuing a grant is driven by an invite code rather than a free-typed user id: the master
 * generates a code/QR, the candidate enters it in their own Settings (see
 * `support-delegate-optin-view.ts`), and the resulting signed request shows up here for explicit
 * review + one-click approval — removing the old typo/wrong-person risk entirely.
 */

export type SupportDelegatesViewDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, params: Record<string, string | number>) => string;
  formatDate: (date: Date) => string;
  now?: () => number;
  /** Generates a fresh invite code (master-only); null if not currently the master session. */
  onCreateInvite: () => { code: string; expiresAt: number } | null;
  /** Approve a pending request — reuses the same issue path as a manual re-issue/renewal. */
  onIssue: (input: { delegateUserId: string; label: string; ttlDays: number }) => void;
  onRevoke: (delegatePub: string) => void;
};

const RENEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function grantStatus(grant: TechSupportDelegateGrant, deps: SupportDelegatesViewDeps): string {
  if (grant.revokedAt) return deps.text('supportDelegatesStatusRevoked');
  if (new Date(grant.expiresAt).getTime() <= (deps.now?.() ?? Date.now())) return deps.text('supportDelegatesStatusExpired');
  return deps.text('supportDelegatesStatusActive');
}

export function renderSupportDelegatesSection(
  deps: SupportDelegatesViewDeps,
  grants: readonly TechSupportDelegateGrant[],
  delegateActivity: readonly SupportFaqEntry[],
  pendingRequests: readonly TechSupportDelegateRequest[] = [],
): void {
  const container = document.getElementById('support-delegates-section');
  if (!container) return;

  const now = deps.now?.() ?? Date.now();
  const sorted = [...grants].sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));

  container.innerHTML = `
    <section style="padding:16px;background:#fff;border:1px solid var(--border);border-radius:8px;">
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:4px;">${deps.text('supportDelegatesTitle')}</div>
      <div style="font-size:0.82em;color:var(--text-tertiary);margin-bottom:12px;">${deps.text('supportDelegatesHelp')}</div>
      <div style="margin-bottom:14px;">
        <button type="button" class="btn primary-btn" id="support-delegate-invite-btn" data-testid="support-delegate-invite-btn">${deps.text('supportDelegatesInvite')}</button>
      </div>
      <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${deps.text('supportDelegatesPendingTitle')}</div>
      <div style="display:grid;gap:8px;margin-bottom:16px;" id="support-delegate-pending-list">
        ${
          pendingRequests.length === 0
            ? `<div style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('supportDelegatesPendingEmpty')}</div>`
            : pendingRequests
                .map(
                  (req) => `
                    <div class="support-delegate-pending-item" data-request-id="${deps.escapeHtml(req.requestId)}" data-candidate-pub="${deps.escapeHtml(req.candidatePub)}" data-candidate-userid="${deps.escapeHtml(req.candidateUserId)}" style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-subtle);">
                      <div style="min-width:0;flex:1 1 160px;">
                        <div style="font-weight:600;">${deps.escapeHtml(req.candidateUserId)}</div>
                        <div style="font-family:monospace;font-size:0.76em;color:var(--text-secondary);">${deps.escapeHtml(formatIdentityFingerprint(req.candidatePub))}</div>
                        <div style="font-size:0.76em;color:var(--text-tertiary);">${deps.tf('supportDelegatesRequestedLabel', { date: deps.formatDate(new Date(req.requestedAt)) })}</div>
                      </div>
                      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;flex:1;min-width:120px;">
                        <span>${deps.text('supportDelegatesLabelLabel')}</span>
                        <input type="text" class="form-input support-delegate-pending-label" data-testid="support-delegate-pending-label" value="${deps.escapeHtml(req.candidateUserId)}" />
                      </label>
                      <label style="display:flex;flex-direction:column;gap:4px;font-size:0.85em;width:90px;">
                        <span>${deps.text('supportDelegatesTtlLabel')}</span>
                        <input type="number" class="form-input support-delegate-pending-ttl" data-testid="support-delegate-pending-ttl" min="1" max="90" value="30" />
                      </label>
                      <button type="button" class="btn primary-btn support-delegate-approve-btn" data-testid="support-delegate-approve-btn">${deps.text('supportDelegatesApprove')}</button>
                    </div>
                  `,
                )
                .join('')
        }
      </div>
      <div style="display:grid;gap:8px;margin-bottom:16px;">
        ${
          sorted.length === 0
            ? `<div style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('supportDelegatesEmpty')}</div>`
            : sorted
                .map((grant) => {
                  const status = grantStatus(grant, deps);
                  const expiresAtMs = new Date(grant.expiresAt).getTime();
                  const canRevoke = !grant.revokedAt && expiresAtMs > now;
                  const canRenew = !grant.revokedAt && expiresAtMs - now < RENEW_WINDOW_MS;
                  return `
                    <div class="support-delegate-item" data-delegate-pub="${deps.escapeHtml(grant.delegatePub)}" data-delegate-userid="${deps.escapeHtml(grant.delegateUserId)}" data-delegate-label="${deps.escapeHtml(grant.label)}" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;background:var(--bg-subtle);">
                      <div style="min-width:0;">
                        <div style="font-weight:600;">${deps.escapeHtml(grant.label || grant.delegateUserId)}</div>
                        <div style="font-size:0.76em;color:var(--text-tertiary);">${status} · ${deps.tf('supportDelegatesExpiresLabel', { date: deps.formatDate(new Date(grant.expiresAt)) })}</div>
                      </div>
                      <div style="display:flex;gap:6px;flex:none;">
                        ${canRenew ? `<button type="button" class="btn support-delegate-renew-btn" data-testid="support-delegate-renew-btn">${deps.text('supportDelegatesRenew')}</button>` : ''}
                        ${canRevoke ? `<button type="button" class="btn support-delegate-revoke-btn" data-testid="support-delegate-revoke-btn">${deps.text('supportDelegatesRevoke')}</button>` : ''}
                      </div>
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

  container.querySelector<HTMLButtonElement>('#support-delegate-invite-btn')?.addEventListener('click', () => {
    openInviteDialog(deps);
  });

  container.querySelectorAll<HTMLElement>('.support-delegate-pending-item').forEach((item) => {
    const candidateUserId = item.dataset.candidateUserid || '';
    item.querySelector<HTMLButtonElement>('.support-delegate-approve-btn')?.addEventListener('click', () => {
      const label = (item.querySelector('.support-delegate-pending-label') as HTMLInputElement | null)?.value.trim() || candidateUserId;
      const ttlDays = Number((item.querySelector('.support-delegate-pending-ttl') as HTMLInputElement | null)?.value) || 30;
      if (!candidateUserId) return;
      deps.onIssue({ delegateUserId: candidateUserId, label, ttlDays });
    });
  });

  container.querySelectorAll<HTMLElement>('.support-delegate-item').forEach((item) => {
    const delegatePub = item.dataset.delegatePub || '';
    const delegateUserId = item.dataset.delegateUserid || '';
    const label = item.dataset.delegateLabel || '';
    item.querySelector<HTMLButtonElement>('.support-delegate-revoke-btn')?.addEventListener('click', () => {
      if (delegatePub) deps.onRevoke(delegatePub);
    });
    item.querySelector<HTMLButtonElement>('.support-delegate-renew-btn')?.addEventListener('click', () => {
      if (delegateUserId) deps.onIssue({ delegateUserId, label, ttlDays: 30 });
    });
  });
}

/** Small invite-code dialog: generate → show code/QR + a live countdown, mirroring
 * `linked-devices-dialog.ts`'s link-code dialog (a distinct code family, never interchangeable). */
function openInviteDialog(deps: SupportDelegatesViewDeps): void {
  const generated = deps.onCreateInvite();
  if (!generated) return;
  const { code, expiresAt } = generated;
  const opener = document.activeElement as HTMLElement | null;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'support-delegate-invite-modal';
  modal.dataset.testid = 'support-delegate-invite-modal';
  modal.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="support-delegate-invite-title" aria-describedby="support-delegate-invite-help">
      <div class="modal-header"><h3 class="modal-title" id="support-delegate-invite-title">${deps.text('supportDelegatesInvite')}</h3></div>
      <p id="support-delegate-invite-help" style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('supportDelegateInviteCodeHelp')}</p>
      <div data-testid="support-delegate-invite-code" style="font-family:monospace;font-size:0.9em;word-break:break-all;padding:10px;background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;">${deps.escapeHtml(code)}</div>
      <div role="img" aria-label="QR" style="margin:10px auto;width:180px;min-height:180px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff;">
        <canvas id="support-delegate-invite-qr-canvas" width="180" height="180" aria-hidden="true"></canvas>
      </div>
      <div data-testid="support-delegate-invite-countdown" id="support-delegate-invite-countdown" role="timer" style="text-align:center;font-size:0.85em;color:var(--text-secondary);"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="support-delegate-invite-copy" data-testid="support-delegate-invite-copy">${deps.text('copy')}</button>
        <button type="button" class="btn primary-btn" id="support-delegate-invite-done">${deps.text('done')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const qrCanvas = modal.querySelector('#support-delegate-invite-qr-canvas') as HTMLCanvasElement;
  void renderLinkCodeQr(qrCanvas, code).catch(() => {});

  const countdownEl = modal.querySelector('#support-delegate-invite-countdown') as HTMLElement;
  const now = () => deps.now?.() ?? Date.now();
  const tick = (): void => {
    const remaining = expiresAt - now();
    if (remaining <= 0) {
      countdownEl.textContent = deps.text('supportDelegateInviteExpired');
      window.clearInterval(timer);
      return;
    }
    const s = Math.ceil(remaining / 1000);
    countdownEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const timer = window.setInterval(tick, 500);
  tick();

  modal.querySelector('#support-delegate-invite-copy')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(code).catch(() => {});
  });
  const close = (): void => {
    window.clearInterval(timer);
    modal.remove();
    opener?.focus?.();
  };
  modal.querySelector('#support-delegate-invite-done')?.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
}

export type { DelegateInvitePayload };
