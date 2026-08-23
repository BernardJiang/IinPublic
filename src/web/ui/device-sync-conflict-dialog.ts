import type { DeviceSyncImportConflict, DeviceSyncConflictDecision } from '../../shared/device-sync-importer';
import { activateModalAccessibility } from './modal-accessibility';

export interface DeviceSyncConflictDialogDeps {
  conflicts: readonly DeviceSyncImportConflict[];
  text: (key: string, fallback?: string) => string;
}

/** Explicit conflict screen; no default winner and no raw private payload rendering. */
export function showDeviceSyncConflictDialog(
  deps: DeviceSyncConflictDialogDeps,
): Promise<DeviceSyncConflictDecision[] | null> {
  if (deps.conflicts.length === 0) return Promise.resolve([]);
  document.getElementById('device-sync-conflict-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'device-sync-conflict-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'device-sync-conflict-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-m" role="dialog" aria-modal="true" aria-labelledby="device-sync-conflict-title" aria-describedby="device-sync-conflict-help">
      <div class="modal-header"><h3 class="modal-title" id="device-sync-conflict-title">${escapeHtml(deps.text('deviceSyncConflictsTitle', 'Choose which changes to keep'))}</h3></div>
      <p id="device-sync-conflict-help" style="font-size:0.86em;color:var(--text-secondary);">${escapeHtml(deps.text('deviceSyncConflictsHelp', 'These records changed in ways that cannot be merged safely. Review every item. Private contents are not shown on this summary screen.'))}</p>
      <div data-testid="device-sync-conflict-list" style="display:grid;gap:12px;max-height:55vh;overflow:auto;">
        ${deps.conflicts.map((conflict, index) => conflictMarkup(conflict, index, deps.text)).join('')}
      </div>
      <div id="device-sync-conflict-error" role="alert" aria-live="polite" style="min-height:1.2em;color:var(--danger);font-size:0.84em;margin-top:10px;"></div>
      <div class="modal-actions">
        <button type="button" class="btn" id="device-sync-conflict-cancel">${escapeHtml(deps.text('cancel', 'Cancel'))}</button>
        <button type="button" class="btn primary-btn" id="device-sync-conflict-apply" data-testid="device-sync-conflict-apply" disabled>${escapeHtml(deps.text('deviceSyncApplyChoices', 'Apply choices'))}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const apply = overlay.querySelector('#device-sync-conflict-apply') as HTMLButtonElement;
  const error = overlay.querySelector('#device-sync-conflict-error') as HTMLElement;
  const choices = new Map<number, DeviceSyncConflictDecision['resolution']>();
  const update = (): void => {
    apply.disabled = choices.size !== deps.conflicts.length;
    if (!apply.disabled) error.textContent = '';
  };
  overlay.querySelectorAll<HTMLInputElement>('input[data-conflict-index]').forEach((input) => {
    input.addEventListener('change', () => {
      choices.set(Number(input.dataset.conflictIndex), input.value as DeviceSyncConflictDecision['resolution']);
      update();
    });
  });

  let deactivate = (): void => {};
  return new Promise((resolve) => {
    const close = (value: DeviceSyncConflictDecision[] | null): void => {
      deactivate();
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('#device-sync-conflict-cancel')?.addEventListener('click', () => close(null));
    apply.addEventListener('click', () => {
      if (choices.size !== deps.conflicts.length) {
        error.textContent = deps.text('deviceSyncChooseEveryConflict', 'Choose an option for every conflict.');
        return;
      }
      close(deps.conflicts.map((conflict, index) => ({
        category: conflict.category,
        recordId: conflict.recordId,
        resolution: choices.get(index)!,
      })));
    });
    deactivate = activateModalAccessibility(overlay, {
      initialFocus: overlay.querySelector<HTMLInputElement>('input[data-conflict-index]'),
      restoreFocusTo: opener,
      onEscape: () => close(null),
    });
  });
}

function conflictMarkup(
  conflict: DeviceSyncImportConflict,
  index: number,
  text: DeviceSyncConflictDialogDeps['text'],
): string {
  const name = `device-sync-conflict-${index}`;
  return `<fieldset data-testid="device-sync-conflict-${index}" style="border:1px solid var(--border);border-radius:10px;padding:10px;">
    <legend style="font-weight:600;">${escapeHtml(conflict.category)} · ${escapeHtml(conflict.recordId)}</legend>
    <div style="font-size:0.8em;color:var(--text-secondary);margin-bottom:8px;">${escapeHtml(text('deviceSyncConflictVersions', 'This device'))}: v${conflict.local.version}, ${escapeHtml(conflict.local.updatedAt)} · ${escapeHtml(text('deviceSyncOtherDevice', 'Other device'))}: v${conflict.incoming.version}, ${escapeHtml(conflict.incoming.updatedAt)}</div>
    <label style="display:flex;gap:7px;margin:6px 0;"><input type="radio" name="${name}" value="keep-local" data-conflict-index="${index}"> <span>${escapeHtml(text('deviceSyncKeepLocal', 'Keep this device’s version'))}</span></label>
    <label style="display:flex;gap:7px;margin:6px 0;"><input type="radio" name="${name}" value="use-incoming" data-conflict-index="${index}"> <span>${escapeHtml(text('deviceSyncUseIncoming', 'Use the other device’s version'))}</span></label>
  </fieldset>`;
}

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
}
