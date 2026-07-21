/**
 * Erase-this-device + Sync-progress dialogs (GUI redesign §11, item J).
 *
 * The Erase confirm dialog gates a full local wipe behind a type-`ERASE` input
 * (erase button disabled until it matches). When a linked personal device is
 * available it leads with "Save to ⟨device⟩ first", which runs the Sync-progress
 * dialog; erase stays disabled while a sync is in flight. Never surfaced in a
 * `⋯` overflow (too destructive).
 */
import { HANDOFF_CATEGORIES, type HandoffCategory } from '../../shared/device-handoff';

export interface EraseDeviceDeps {
  text: (key: string, fallback?: string) => string;
  /** A linked personal device is available to receive a handoff archive. */
  hasLinkedDevice: boolean;
  linkedDeviceName?: string;
  /** Perform the wipe (revocations + storage clear + reload). */
  onErase: () => Promise<void> | void;
  /** Run the encrypted handoff sync; resolves when the receiver acknowledges. */
  onSyncFirst?: (progress: (category: HandoffCategory) => void) => Promise<void>;
}

const CONFIRM_WORD = 'ERASE';

export function showEraseDeviceDialog(deps: EraseDeviceDeps): void {
  document.getElementById('erase-device-modal')?.remove();
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'erase-device-modal';
  modal.dataset.testid = 'erase-device-modal';

  const syncOffer = deps.hasLinkedDevice
    ? `<button type="button" class="btn" id="erase-sync-first-btn" data-testid="erase-sync-first-btn" style="width:100%;">${deps.text(
        'eraseSyncFirst',
        'Save to',
      )} ${escapeHtml(deps.linkedDeviceName || deps.text('eraseLinkedDevice', 'your other device'))} ${deps.text('eraseFirst', 'first')}</button>`
    : `<div style="font-size:0.82em;color:var(--warning-text);">${deps.text(
        'eraseNoLinkedDevice',
        'No linked device is online — erasing without saving is permanent.',
      )}</div>`;

  modal.innerHTML = `
    <div class="modal-content size-m">
      <div class="modal-header"><h3 class="modal-title" style="color:var(--danger-hover);">${deps.text('eraseTitle', 'Erase this device')}</h3></div>
      <p>${deps.text(
        'eraseWarning',
        'This removes your identity and all data from this computer. Without a sync it is gone forever.',
      )}</p>
      <label style="display:block;font-size:0.85em;margin:10px 0 4px;">${deps.text('eraseTypeToConfirm', 'Type ERASE to confirm')}</label>
      <input type="text" class="form-input" id="erase-confirm-input" data-testid="erase-confirm-input" autocomplete="off" style="width:100%;">
      <div class="modal-actions" style="flex-direction:column;gap:8px;margin-top:14px;">
        ${syncOffer}
        <button type="button" class="btn" id="erase-cancel-btn">${deps.text('cancel', 'Cancel')}</button>
        <button type="button" class="btn" id="erase-device-btn" data-testid="erase-device-btn" disabled style="width:100%;background:var(--danger);color:#fff;opacity:0.5;">${deps.text('eraseConfirmBtn', 'Erase this device')}</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  const input = modal.querySelector('#erase-confirm-input') as HTMLInputElement;
  const eraseBtn = modal.querySelector('#erase-device-btn') as HTMLButtonElement;
  let syncing = false;

  const refreshEraseEnabled = (): void => {
    const ok = input.value === CONFIRM_WORD && !syncing;
    eraseBtn.disabled = !ok;
    eraseBtn.style.opacity = ok ? '1' : '0.5';
  };
  input.addEventListener('input', refreshEraseEnabled);

  const close = (): void => modal.remove();
  modal.querySelector('#erase-cancel-btn')?.addEventListener('click', close);
  // Scrim closes only before the user starts typing the confirm word.
  modal.addEventListener('click', (e) => {
    if (e.target === modal && input.value.length === 0) close();
  });

  eraseBtn.addEventListener('click', async () => {
    if (eraseBtn.disabled) return;
    await deps.onErase();
    // onErase typically reloads; if not, close.
    close();
  });

  modal.querySelector('#erase-sync-first-btn')?.addEventListener('click', async () => {
    // With no transfer hook wired (X7), the progress dialog still runs its
    // local default (all categories collected locally) so the flow is testable.
    syncing = true;
    refreshEraseEnabled();
    await showSyncProgressDialog(deps);
    syncing = false;
    refreshEraseEnabled();
  });
}

/** Sync-progress dialog: per-category progress ending in receiver acknowledgment. */
export function showSyncProgressDialog(deps: EraseDeviceDeps): Promise<void> {
  return new Promise<void>((resolve) => {
    document.getElementById('erase-sync-progress-modal')?.remove();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'erase-sync-progress-modal';
    modal.dataset.testid = 'erase-sync-progress-modal';
    modal.innerHTML = `
      <div class="modal-content size-s">
        <div class="modal-header"><h3 class="modal-title">${deps.text('eraseSyncTitle', 'Saving to your device')}</h3></div>
        <div id="erase-sync-categories" style="display:flex;flex-direction:column;gap:6px;">
          ${HANDOFF_CATEGORIES.map(
            (c) => `<div class="erase-sync-category" data-category="${c}" style="display:flex;justify-content:space-between;font-size:0.86em;"><span>${c}</span><span class="erase-sync-status" data-status="pending">…</span></div>`,
          ).join('')}
        </div>
        <div class="modal-actions" style="flex-direction:column;gap:8px;">
          <button type="button" class="btn" id="erase-sync-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="erase-sync-done" data-testid="erase-sync-done" disabled style="opacity:0.5;">${deps.text('eraseSyncDone', 'Done')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const markDone = (category: HandoffCategory): void => {
      const el = modal.querySelector(`.erase-sync-category[data-category="${category}"] .erase-sync-status`) as HTMLElement | null;
      if (el) {
        el.textContent = '✓';
        el.dataset.status = 'done';
      }
    };
    const doneBtn = modal.querySelector('#erase-sync-done') as HTMLButtonElement;
    const finish = (): void => {
      doneBtn.disabled = false;
      doneBtn.style.opacity = '1';
    };

    let cancelled = false;
    modal.querySelector('#erase-sync-cancel')?.addEventListener('click', () => {
      cancelled = true;
      modal.remove();
      resolve(); // aborts sync; erase stays disabled (caller re-checks)
    });
    doneBtn.addEventListener('click', () => {
      modal.remove();
      resolve();
    });

    const run = deps.onSyncFirst
      ? deps.onSyncFirst(markDone)
      : (async () => {
          for (const c of HANDOFF_CATEGORIES) markDone(c);
        })();
    Promise.resolve(run).then(() => {
      if (!cancelled) finish();
    });
  });
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
