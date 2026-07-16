/**
 * Linked devices page + dialogs (GUI redesign §10.4, TODO item I).
 *
 * Renders the Settings › Linked devices page (S8): the linked-identity list with
 * per-row Unlink, plus the three size-S dialogs — Link-device code (code + QR +
 * countdown + copy), Enter-code (input + inline error), and Unlink confirm.
 *
 * The code lifecycle and validation come from the shared protocol
 * (`src/shared/identity-linking.ts`); signed-attestation publishing is delegated
 * to the injected `deps.completeFromCode` when a real service is wired.
 */
import {
  PairingPayload,
  createPairingPayload,
  encodePairingCode,
  decodePairingCode,
  isPairingExpired,
  PAIRING_TTL_MS,
} from '../../shared/identity-linking';

export interface LinkedDeviceRow {
  pub: string;
  stageName: string;
  platform: string;
  linkedAt: number;
}

export interface LinkedDevicesDeps {
  /** Localised string lookup. */
  text: (key: string, fallback?: string) => string;
  /** Current linked-device rows to display. */
  listRecords: () => LinkedDeviceRow[];
  /** A fresh unguessable secret (SEA-backed when available). */
  randomSecret: () => string;
  /** This device's public key (for the code payload). */
  selfPub: () => string;
  /** Complete a link from a typed code; returns an error key or null on success. */
  completeFromCode: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | null>;
  /** Remove a link (publishes a revocation when a service is wired). */
  unlink: (pub: string) => Promise<void> | void;
  now?: () => number;
}

const glyphFor = (platform: string): string =>
  platform === 'ios' || platform === 'iphone'
    ? '📱'
    : platform === 'android'
      ? '🤖'
      : platform === 'desktop' || platform === 'electron'
        ? '💻'
        : '🌐';

export function showLinkedDevicesDialog(deps: LinkedDevicesDeps): void {
  document.getElementById('linked-devices-overlay')?.remove();
  const now = () => (deps.now ? deps.now() : Date.now());

  const overlay = document.createElement('div');
  overlay.id = 'linked-devices-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'linked-devices-overlay';

  const renderList = (): string => {
    const rows = deps.listRecords();
    if (rows.length === 0) {
      return `<div data-testid="linked-devices-empty" style="padding:16px;color:#6b7280;text-align:center;">${deps.text(
        'linkedDevicesEmpty',
        'No linked devices yet.',
      )}</div>`;
    }
    return rows
      .map(
        (r) => `
        <div class="linked-device-row" data-testid="linked-device-row" data-pub="${escapeAttr(r.pub)}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.2em;">${glyphFor(r.platform)}</span>
            <div>
              <div style="font-weight:600;">${escapeHtml(r.stageName || 'Device')}</div>
              <div style="font-size:0.8em;color:#6b7280;">${new Date(r.linkedAt).toLocaleDateString()}</div>
            </div>
          </div>
          <button type="button" class="btn linked-device-unlink-btn" data-testid="linked-device-unlink-btn" data-pub="${escapeAttr(r.pub)}">${deps.text('unlink', 'Unlink')}</button>
        </div>`,
      )
      .join('');
  };

  const render = (): void => {
    overlay.innerHTML = `
      <div class="modal-content size-s modal-fullscreen" data-testid="linked-devices-page">
        <div class="modal-header" style="display:flex;align-items:center;justify-content:space-between;">
          <h2 class="modal-title">${deps.text('linkedDevicesTitle', 'Linked devices')}</h2>
          <button class="close-button" id="linked-devices-close" data-testid="linked-devices-close" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
        </div>
        <div id="linked-devices-list">${renderList()}</div>
        <div class="modal-actions" style="flex-wrap:wrap;">
          <button type="button" class="btn primary-btn" id="link-a-device-btn" data-testid="link-a-device-btn">${deps.text('linkADevice', 'Link a device')}</button>
          <button type="button" class="btn" id="enter-link-code-btn" data-testid="enter-link-code-btn">${deps.text('enterLinkCode', 'Enter link code')}</button>
        </div>
      </div>`;
    bind();
  };

  const close = (): void => overlay.remove();

  const bind = (): void => {
    overlay.querySelector('#linked-devices-close')?.addEventListener('click', close);
    overlay.querySelector('#link-a-device-btn')?.addEventListener('click', openCodeDialog);
    overlay.querySelector('#enter-link-code-btn')?.addEventListener('click', openEnterCodeDialog);
    overlay.querySelectorAll('.linked-device-unlink-btn').forEach((btn) => {
      btn.addEventListener('click', () => openUnlinkConfirm((btn as HTMLElement).dataset.pub || ''));
    });
  };

  // --- Link-device code dialog (size S) ---------------------------------------
  function openCodeDialog(): void {
    const payload: PairingPayload = createPairingPayload(deps.selfPub(), { randomSecret: deps.randomSecret } as any, now());
    const code = encodePairingCode(payload);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'link-device-code-modal';
    modal.dataset.testid = 'link-device-code-modal';
    modal.innerHTML = `
      <div class="modal-content size-s">
        <div class="modal-header"><h3 class="modal-title">${deps.text('linkADevice', 'Link a device')}</h3></div>
        <p style="font-size:0.85em;color:#6b7280;">${deps.text('linkCodeHelp', 'Enter this code on your other device before it expires.')}</p>
        <div data-testid="link-device-code" id="link-device-code" style="font-family:monospace;font-size:0.9em;word-break:break-all;padding:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;">${escapeHtml(code)}</div>
        <div data-testid="link-device-qr" style="margin:10px auto;width:140px;height:140px;display:flex;align-items:center;justify-content:center;border:1px dashed #cbd5e1;border-radius:8px;color:#94a3b8;font-size:0.8em;">QR</div>
        <div data-testid="link-device-countdown" id="link-device-countdown" style="text-align:center;font-size:0.85em;color:#475569;"></div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="link-device-copy" id="link-device-copy">${deps.text('copy', 'Copy')}</button>
          <button type="button" class="btn primary-btn" id="link-device-done">${deps.text('done', 'Done')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const countdownEl = modal.querySelector('#link-device-countdown') as HTMLElement;
    const tick = (): void => {
      const remaining = payload.expiresAt - now();
      if (remaining <= 0) {
        countdownEl.textContent = deps.text('linkCodeExpired', 'Code expired');
        countdownEl.dataset.expired = 'true';
        window.clearInterval(timer);
        return;
      }
      const s = Math.ceil(remaining / 1000);
      countdownEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const timer = window.setInterval(tick, 500);
    tick();

    modal.querySelector('#link-device-copy')?.addEventListener('click', () => {
      navigator.clipboard?.writeText(code).catch(() => {});
    });
    const closeCode = (): void => {
      window.clearInterval(timer);
      modal.remove();
    };
    modal.querySelector('#link-device-done')?.addEventListener('click', closeCode);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCode();
    });
  }

  // --- Enter link code dialog (size S) ----------------------------------------
  function openEnterCodeDialog(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'enter-link-code-modal';
    modal.dataset.testid = 'enter-link-code-modal';
    modal.innerHTML = `
      <div class="modal-content size-s">
        <div class="modal-header"><h3 class="modal-title">${deps.text('enterLinkCode', 'Enter link code')}</h3></div>
        <input type="text" class="form-input" id="enter-link-code-input" data-testid="enter-link-code-input" placeholder="${deps.text('linkCodePlaceholder', 'Paste link code')}" style="width:100%;">
        <div id="enter-link-code-error" data-testid="enter-link-code-error" style="color:#dc2626;font-size:0.82em;min-height:1em;margin-top:6px;"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="enter-link-code-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="enter-link-code-submit" data-testid="enter-link-code-submit">${deps.text('link', 'Link')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const errorEl = modal.querySelector('#enter-link-code-error') as HTMLElement;
    const input = modal.querySelector('#enter-link-code-input') as HTMLInputElement;

    const errorText = (key: 'invalid' | 'expired' | 'reused' | 'self'): string =>
      ({
        invalid: deps.text('linkErrorInvalid', 'That code is invalid.'),
        expired: deps.text('linkErrorExpired', 'That code has expired.'),
        reused: deps.text('linkErrorReused', 'That device is already linked.'),
        self: deps.text('linkErrorSelf', 'You cannot link a device to itself.'),
      })[key];

    const submit = async (): Promise<void> => {
      errorEl.textContent = '';
      const raw = input.value.trim();
      // Fast local validation for immediate feedback.
      const decoded = decodePairingCode(raw);
      if (!decoded) {
        errorEl.textContent = errorText('invalid');
        return;
      }
      if (isPairingExpired(decoded, now())) {
        errorEl.textContent = errorText('expired');
        return;
      }
      const err = await deps.completeFromCode(raw);
      if (err) {
        errorEl.textContent = errorText(err);
        return;
      }
      modal.remove();
      render(); // refresh the list
    };

    modal.querySelector('#enter-link-code-submit')?.addEventListener('click', () => void submit());
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void submit();
    });
    const cancel = (): void => modal.remove();
    modal.querySelector('#enter-link-code-cancel')?.addEventListener('click', cancel);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cancel();
    });
  }

  // --- Unlink confirm (size S) ------------------------------------------------
  function openUnlinkConfirm(pub: string): void {
    const row = deps.listRecords().find((r) => r.pub === pub);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'unlink-device-confirm';
    modal.dataset.testid = 'unlink-device-confirm';
    modal.innerHTML = `
      <div class="modal-content size-s">
        <div class="modal-header"><h3 class="modal-title">${deps.text('unlinkTitle', 'Unlink device')}</h3></div>
        <p>${deps.text('unlinkConfirm', 'Remove the link to')} <strong>${escapeHtml(row?.stageName || 'this device')}</strong>?</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="unlink-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="unlink-confirm-btn" data-testid="unlink-confirm-btn">${deps.text('unlink', 'Unlink')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#unlink-cancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#unlink-confirm-btn')?.addEventListener('click', async () => {
      await deps.unlink(pub);
      modal.remove();
      render();
    });
  }

  document.body.appendChild(overlay);
  render();
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export { PAIRING_TTL_MS };
