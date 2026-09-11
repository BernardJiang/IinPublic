import { escapeHtml } from './ui-formatters';
import type { UiTranslationKey } from './ui-translations';
import type { BroadcastAudiencePreview } from './broadcast-audience-preview';

export type BroadcastAudienceDialogDeps = {
  t: (key: UiTranslationKey) => string;
  tf: (key: UiTranslationKey, vars: Record<string, string | number>) => string;
  deliveryReasonLabel: (reason: string) => string;
  formatReasonCounts: (counts: Record<string, number>) => string;
};

/**
 * Pre-send confirmation for a bulk/broadcast talk send: shows a per-talk eligible/excluded
 * breakdown (including sender-omitted and preview-unavailable talks) before the user commits.
 * Called externally from `app.ts` — a public `UIManager` API contract, not just an internal
 * helper.
 */
export function confirmBroadcastAudience(
  previews: BroadcastAudiencePreview[],
  deps: BroadcastAudienceDialogDeps,
): Promise<boolean> {
  const { t, tf, deliveryReasonLabel, formatReasonCounts } = deps;
  document.getElementById('broadcast-preamble-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'broadcast-preamble-modal';
  modal.dataset.testid = 'broadcast-preamble-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:5000;background:rgba(15,23,42,0.48);display:flex;align-items:center;justify-content:center;padding:20px;';
  const knownPreviews = previews.filter((preview) => !preview.previewUnavailable);
  const deliveryCount = knownPreviews.reduce((count, preview) => count + preview.eligibleReceivers, 0);
  const candidateCount = knownPreviews.reduce((count, preview) => count + preview.totalCandidates, 0);
  const supportExcludedCount = knownPreviews.reduce((count, preview) => count + (preview.supportExcludedCount || 0), 0);
  const excludedCount = Math.max(0, candidateCount - deliveryCount) + supportExcludedCount;
  const hasUnavailable = knownPreviews.length !== previews.length;
  const rows = previews.map((preview) => {
    if (preview.senderOmittedBy?.length) {
      const reasonText = preview.senderOmittedBy
        .map((reason) => deliveryReasonLabel(reason))
        .join(' · ');
      return `
        <div class="broadcast-preview-row broadcast-preview-row-omitted" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--danger-border);border-radius:10px;background:var(--danger-soft);">
          <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
          <div style="font-size:0.88em;color:var(--danger-hover);margin-top:4px;">0 ${t('broadcastPreviewEligible')} · ${t('broadcastPreviewSenderOmitted')}</div>
          <div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(reasonText)}</div>
        </div>
      `;
    }
    if (preview.previewUnavailable) {
      return `
        <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--border);border-radius:10px;">
          <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
          <div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${t('broadcastPreviewUnavailable')}</div>
        </div>
      `;
    }
    const reasonText = formatReasonCounts(preview.rejectedByCounts);
    const recipientText = (preview.eligibleReceiverNames || []).join(', ') || t('broadcastPreviewNone');
    const rejectedDetailText = (preview.rejectedReceiverDetails || [])
      .map(({ name, rejectedBy }) => {
        const reasonCounts = Object.fromEntries(rejectedBy.map((reason) => [reason, 1]));
        return `${name}: ${formatReasonCounts(reasonCounts)}`;
      })
      .join('; ');
    const perTalkExcluded = Math.max(0, preview.totalCandidates - preview.eligibleReceivers)
      + (preview.supportExcludedCount || 0);
    return `
      <div class="broadcast-preview-row" data-talk-id="${escapeHtml(preview.talkId)}" style="padding:10px;border:1px solid var(--border);border-radius:10px;">
        <div style="font-weight:600;">${escapeHtml(preview.title)}</div>
        <div style="font-size:0.88em;color:var(--text-secondary);margin-top:4px;">${preview.eligibleReceivers} ${t('broadcastPreviewEligible')} · ${perTalkExcluded} ${t('broadcastPreviewExcluded')}</div>
        <div class="broadcast-preview-recipients" style="font-size:0.82em;color:var(--text-secondary);margin-top:4px;">${escapeHtml(tf('broadcastPreviewRecipients', { names: recipientText }))}</div>
        ${reasonText ? `<div class="broadcast-preview-reasons" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(reasonText)}</div>` : ''}
        ${rejectedDetailText ? `<div class="broadcast-preview-skipped" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(tf('broadcastPreviewSkipped', { details: rejectedDetailText }))}</div>` : ''}
        ${preview.supportExcludedCount ? `<div class="broadcast-preview-support" style="font-size:0.82em;color:var(--text-tertiary);margin-top:4px;">${escapeHtml(tf('broadcastPreviewSupportExcluded', { count: preview.supportExcludedCount }))}</div>` : ''}
      </div>
    `;
  }).join('');
  modal.innerHTML = `
    <div style="width:min(620px,96vw);max-height:90vh;overflow:auto;background:var(--surface);border-radius:16px;box-shadow:0 18px 55px rgba(15,23,42,0.2);">
      <div style="padding:18px;border-bottom:1px solid var(--border);">
        <div style="font-size:1.05em;font-weight:700;">${t('broadcastPreviewTitle')}</div>
        <div style="font-size:0.88em;color:var(--text-tertiary);margin-top:5px;">${t('broadcastPreviewHelp')}</div>
        <span class="broadcast-chip" style="display:inline-flex;margin-top:10px;padding:4px 9px;border-radius:999px;background:var(--accent-soft);color:var(--accent-hover);font-size:0.82em;">${tf(previews.length === 1 ? 'talksCountOne' : 'talksCount', { count: previews.length })} · ${deliveryCount} ${t('broadcastPreviewEligible')} · ${excludedCount} ${t('broadcastPreviewExcluded')}${hasUnavailable ? ` · ${t('broadcastPreviewFinalCheck')}` : ''}</span>
      </div>
      <div style="display:grid;gap:8px;padding:14px;">${rows}</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;padding:14px 18px;border-top:1px solid var(--border);">
        <button class="btn" type="button" data-testid="broadcast-preamble-cancel">${t('broadcastPreviewCancel')}</button>
        <button class="btn primary-btn" type="button" data-testid="broadcast-preamble-send">${t('broadcastPreviewSend')}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  return new Promise<boolean>((resolve) => {
    const finish = (confirmed: boolean) => {
      modal.remove();
      resolve(confirmed);
    };
    modal.querySelector('[data-testid="broadcast-preamble-send"]')?.addEventListener('click', () => finish(true));
    modal.querySelector('[data-testid="broadcast-preamble-cancel"]')?.addEventListener('click', () => finish(false));
    modal.addEventListener('click', (event) => {
      if (event.target === modal) finish(false);
    });
  });
}
