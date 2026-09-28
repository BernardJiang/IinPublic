import type { RecoveryAnchorRecord } from '../../shared/techsupport-recovery';
import type { UiTranslationKey } from './ui-translations';

/**
 * docs/TODO.md OPEN-29: surfaces a TechSupport recovery-anchor event to the master operator.
 * Previously this had no UI at all — only a `console.warn` (app.ts's
 * `subscribeToTechSupportRecoveryAnchor`) and whatever `npm run techsupport:recovery -- status`
 * reports from the command line. Renders nothing when there has never been a recovery record
 * (the normal, no-incident state every installation starts in).
 */
export type TechSupportRecoveryBannerDeps = {
  escapeHtml: (text: string) => string;
  text: (key: UiTranslationKey) => string;
  formatDate: (date: Date) => string;
  record: RecoveryAnchorRecord | null;
};

export function renderTechSupportRecoveryBanner(deps: TechSupportRecoveryBannerDeps): void {
  const container = document.getElementById('techsupport-recovery-banner-section');
  if (!container) return;
  if (!deps.record) {
    container.innerHTML = '';
    return;
  }
  const { reason, issuedAt, revokedDmPubs, revokedAnnouncementPubs, nextDmPub, nextAnnouncementPub } = deps.record;
  const revokedCount = revokedDmPubs.length + revokedAnnouncementPubs.length;
  const issuedDate = new Date(issuedAt);
  const issuedLabel = Number.isFinite(issuedDate.getTime()) ? deps.formatDate(issuedDate) : deps.escapeHtml(issuedAt);
  const extras = [
    nextDmPub ? 'a new DM key is trusted' : null,
    nextAnnouncementPub ? 'a new announcement key is trusted' : null,
  ].filter(Boolean);
  container.innerHTML = `
    <div
      data-testid="techsupport-recovery-banner"
      style="padding:10px 12px;border-radius:8px;background:var(--warning-soft);border:1px solid var(--warning-border);margin-bottom:14px;"
    >
      <div style="font-weight:700;color:var(--warning-text);">⚠️ ${deps.escapeHtml(deps.text('techSupportRecoveryBannerTitle'))}</div>
      <div style="font-size:0.85em;margin-top:4px;">${deps.escapeHtml(reason)}</div>
      <div style="font-size:0.78em;color:var(--text-secondary);margin-top:4px;">
        ${issuedLabel} · ${revokedCount} key${revokedCount === 1 ? '' : 's'} revoked${extras.length ? ` · ${extras.join(' · ')}` : ''}
      </div>
    </div>
  `;
}
