/**
 * Identity & devices page + linking dialogs.
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
import { avatarInnerHtml } from './profile-avatar';
import { formatIdentityFingerprint, type LocalDeviceMetadata } from '../services/local-device-metadata';
import { activateModalAccessibility } from './modal-accessibility';
import { isQrCameraScanSupported, renderLinkCodeQr, startQrCameraScan } from './link-code-qr';

export interface LinkedDeviceRow {
  pub: string;
  stageName: string;
  platform: string;
  linkedAt: number;
  state?: 'waiting' | 'linked' | 'revocation-pending' | 'removed' | 'invalid';
}

export interface IdentityDeviceSummary {
  pub: string;
  stageName: string;
  headshot?: string;
  createdAt: number;
  status: 'available' | 'locked' | 'needs-attention';
}

export interface IncomingLinkRequestSummary {
  peerPub: string;
  issuedAt: number;
  expiresAt: number;
}

export interface LinkedDevicesDeps {
  /** Localised string lookup. */
  text: (key: string, fallback?: string) => string;
  /** Current linked-device rows to display. */
  listRecords: () => LinkedDeviceRow[];
  /** Current SEA identity. The full public key remains in the closure, not default markup. */
  identity: IdentityDeviceSummary;
  /** Privacy-minimized metadata for this installation. */
  device: () => LocalDeviceMetadata;
  /** Current app version/build label. */
  appVersion: string;
  /** Persist a new local-only display name for this installation. */
  renameDevice: (name: string) => LocalDeviceMetadata;
  /** A fresh unguessable secret (SEA-backed when available). */
  randomSecret: () => string;
  /** This device's public key (for the code payload). */
  selfPub: () => string;
  /** Create a pairing code and retain its one-time secret for mutual confirmation. */
  createLinkCode?: (now: number) => { payload: PairingPayload; code: string };
  /** Read the signed request addressed to the currently displayed pairing code. */
  readIncomingRequest?: () => Promise<IncomingLinkRequestSummary | null>;
  /** Explicitly approve the request and publish this device's reciprocal signature. */
  approveIncomingRequest?: (peerPub: string) => Promise<boolean>;
  /** Cancel the pending code when its dialog is dismissed. */
  cancelPendingRequest?: (requestId: string) => void;
  /** Re-resolve local candidate rows against signed graph state. */
  refreshRecords?: () => Promise<void>;
  /** Complete a link from a typed code; returns an error key or null on success. */
  completeFromCode: (code: string) => Promise<'invalid' | 'expired' | 'reused' | 'self' | 'unavailable' | null>;
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

const stateTextKey = (state: LinkedDeviceRow['state']): string =>
  ({
    waiting: 'linkedDeviceStateWaiting',
    linked: 'linkedDeviceStateLinked',
    'revocation-pending': 'linkedDeviceStateRevocationPending',
    removed: 'linkedDeviceStateRemoved',
    invalid: 'linkedDeviceStateInvalid',
  })[state || 'linked'];

export function showLinkedDevicesDialog(deps: LinkedDevicesDeps): void {
  document.getElementById('linked-devices-overlay')?.remove();
  const now = () => (deps.now ? deps.now() : Date.now());
  const pageOpener = document.activeElement as HTMLElement | null;

  const overlay = document.createElement('div');
  overlay.id = 'linked-devices-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'linked-devices-overlay';

  const renderList = (): string => {
    const rows = deps.listRecords();
    if (rows.length === 0) {
      return `<div data-testid="linked-devices-empty" style="padding:16px;color:var(--text-tertiary);text-align:center;">
        <div style="font-weight:700;color:var(--text-primary);">${deps.text('linkedDevicesEmpty', 'No linked devices')}</div>
        <div style="font-size:0.86em;margin-top:4px;">${deps.text('linkedDevicesEmptyHelp', 'Link another device you control. Private keys stay on the device that created them.')}</div>
      </div>`;
    }
    return rows
      .map(
        (r) => `
        <div class="linked-device-row identity-linked-device-row" data-testid="linked-device-row" data-pub="${escapeAttr(r.pub)}">
          <div class="identity-linked-device-summary">
            <span aria-hidden="true" style="font-size:1.2em;">${glyphFor(r.platform)}</span>
            <div style="min-width:0;">
              <div style="font-weight:600;">${escapeHtml(r.stageName || 'Device')}</div>
              <div style="font-family:monospace;font-size:0.78em;color:var(--text-secondary);">${escapeHtml(formatIdentityFingerprint(r.pub))}</div>
              <div style="font-size:0.8em;color:var(--text-tertiary);">${deps.text(stateTextKey(r.state), 'Linked')} · ${new Date(r.linkedAt).toLocaleDateString()}</div>
            </div>
          </div>
          <button type="button" class="btn linked-device-unlink-btn" data-testid="linked-device-unlink-btn" data-pub="${escapeAttr(r.pub)}">${deps.text('unlink', 'Unlink')}</button>
        </div>`,
      )
      .join('');
  };

  const render = (): void => {
    const identity = deps.identity;
    const device = deps.device();
    const identityFingerprint = formatIdentityFingerprint(identity.pub);
    const identityStatus = identity.status === 'locked'
      ? deps.text('identityStatusLocked', 'Locked')
      : identity.status === 'needs-attention'
        ? deps.text('identityStatusNeedsAttention', 'Needs attention')
        : deps.text('identityStatusAvailable', 'Available on this device');
    overlay.innerHTML = `
      <div class="modal-content size-s modal-fullscreen identity-devices-page" data-testid="linked-devices-page" role="dialog" aria-modal="true" aria-labelledby="identity-devices-title" aria-describedby="identity-storage-note">
        <div class="modal-header identity-devices-header" style="display:flex;align-items:center;justify-content:space-between;">
          <h2 class="modal-title" id="identity-devices-title">${deps.text('identityDevicesTitle', 'Identity & devices')}</h2>
          <button type="button" class="close-button" id="linked-devices-close" data-testid="linked-devices-close" aria-label="${deps.text('close', 'Close')}" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666;">&times;</button>
        </div>
        <div style="display:grid;gap:12px;">
          <section data-testid="identity-card" style="padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
            <h3 style="margin:0 0 10px;font-size:1em;">${deps.text('identityCardTitle', 'Your identity')}</h3>
            <div style="display:flex;align-items:center;gap:12px;">
              <div class="user-avatar" style="width:52px;height:52px;font-size:1.25em;flex:none;">${avatarInnerHtml(identity.headshot, identity.stageName.charAt(0).toUpperCase() || '?', escapeHtml)}</div>
              <div style="min-width:0;">
                <div style="font-weight:700;">${escapeHtml(identity.stageName)}</div>
                <div data-testid="identity-fingerprint" aria-label="${deps.text('identityFingerprintLabel', 'Identity fingerprint')}" style="font-family:monospace;font-size:0.84em;color:var(--text-secondary);">${escapeHtml(identityFingerprint || deps.text('unavailable', 'Unavailable'))}</div>
                <div data-testid="identity-status" style="font-size:0.8em;color:var(--text-tertiary);">${identityStatus}</div>
              </div>
            </div>
            <p id="identity-storage-note" style="font-size:0.82em;color:var(--text-tertiary);margin:10px 0;">${deps.text('identityStoredLocally', 'This identity is stored on this device. IinPublic does not keep an account copy on a server.')}</p>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <button type="button" class="btn" id="copy-identity-id" data-testid="copy-identity-id" ${identity.pub ? '' : 'disabled'}>${deps.text('copyFullIdentityId', 'Copy full identity ID')}</button>
              <span id="copy-identity-status" role="status" style="font-size:0.8em;color:var(--text-tertiary);"></span>
            </div>
          </section>
          <section data-testid="identity-protection-card" style="padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
            <h3 style="margin:0 0 8px;font-size:1em;">${deps.text('identityProtectionTitle', 'Identity protection')}</h3>
            <div style="font-weight:700;">${deps.text('identityPasswordNotSet', 'Identity password: Not set')}</div>
            <div style="font-size:0.82em;color:var(--text-tertiary);margin-top:3px;">${deps.text('identityOpensAutomatically', 'IinPublic opens automatically on this device.')}</div>
            <div style="font-size:0.78em;color:var(--text-tertiary);margin-top:6px;">${deps.text('identityPasswordPlanned', 'Optional password protection will be added after its custody design is security-reviewed.')}</div>
          </section>
          <section data-testid="current-device-card" style="padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
            <h3 style="margin:0 0 8px;font-size:1em;">${deps.text('thisDeviceTitle', 'This device')}</h3>
            <div class="identity-current-device-summary">
              <div>
                <div data-testid="current-device-name" style="font-weight:700;">${escapeHtml(device.name)}</div>
                <div style="font-size:0.82em;color:var(--text-tertiary);">${escapeHtml(device.platform)} · IinPublic ${escapeHtml(deps.appVersion)}</div>
                <div style="font-size:0.82em;color:var(--text-tertiary);">${deps.text('identityCreatedLabel', 'Identity created')} ${new Date(identity.createdAt || device.createdAt).toLocaleDateString()}</div>
                <div style="font-size:0.82em;color:var(--text-tertiary);">${deps.text('deviceProtectionAutomatic', 'Protection: automatic')}</div>
              </div>
              <span style="font-size:0.76em;padding:3px 7px;border-radius:999px;background:var(--bg-subtle);">${deps.text('thisDeviceBadge', 'This device')}</span>
            </div>
            <button type="button" class="btn" id="rename-current-device" data-testid="rename-current-device" style="margin-top:10px;">${deps.text('renameDevice', 'Rename device')}</button>
          </section>
          <section data-testid="linked-devices-card" style="padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
            <h3 style="margin:0 0 8px;font-size:1em;">${deps.text('linkedDevicesTitle', 'Linked devices')}</h3>
            <p style="font-size:0.8em;color:var(--text-tertiary);margin:0 0 8px;">${deps.text('linkedDevicesNoTransfer', 'A direct link does not authorize data transfer, synchronization, recovery, or merged authorship.')}</p>
            <div id="linked-devices-list">${renderList()}</div>
            <div class="modal-actions" style="flex-wrap:wrap;justify-content:flex-start;">
              <button type="button" class="btn primary-btn" id="link-a-device-btn" data-testid="link-a-device-btn">${deps.text('linkADevice', 'Link a device')}</button>
              <button type="button" class="btn" id="enter-link-code-btn" data-testid="enter-link-code-btn">${deps.text('enterLinkCode', 'Enter or scan a code')}</button>
              <button type="button" class="btn" id="refresh-linked-devices" data-testid="refresh-linked-devices">${deps.text('refreshLinkStatus', 'Refresh status')}</button>
            </div>
          </section>
        </div>
      </div>`;
    bind();
  };

  let deactivatePageAccessibility = (): void => {};
  const close = (): void => {
    deactivatePageAccessibility();
    overlay.remove();
  };

  const bind = (): void => {
    overlay.querySelector('#linked-devices-close')?.addEventListener('click', close);
    overlay.querySelector('#link-a-device-btn')?.addEventListener('click', openLinkStartConfirm);
    overlay.querySelector('#enter-link-code-btn')?.addEventListener('click', openEnterCodeDialog);
    overlay.querySelector('#refresh-linked-devices')?.addEventListener('click', async () => {
      const button = overlay.querySelector('#refresh-linked-devices') as HTMLButtonElement | null;
      if (button) button.disabled = true;
      await deps.refreshRecords?.();
      render();
      (overlay.querySelector('#refresh-linked-devices') as HTMLElement | null)?.focus();
    });
    overlay.querySelector('#copy-identity-id')?.addEventListener('click', async () => {
      const status = overlay.querySelector('#copy-identity-status') as HTMLElement | null;
      try {
        await navigator.clipboard.writeText(deps.identity.pub);
        if (status) status.textContent = deps.text('identityIdCopied', 'Identity ID copied.');
      } catch {
        if (status) status.textContent = deps.text('identityIdCopyFailed', 'Could not copy the identity ID.');
      }
    });
    overlay.querySelector('#rename-current-device')?.addEventListener('click', openRenameDeviceDialog);
    overlay.querySelectorAll('.linked-device-unlink-btn').forEach((btn) => {
      btn.addEventListener('click', () => openUnlinkConfirm((btn as HTMLElement).dataset.pub || ''));
    });
  };

  function openRenameDeviceDialog(): void {
    const current = deps.device();
    const opener = document.activeElement as HTMLElement | null;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'rename-device-modal';
    modal.dataset.testid = 'rename-device-modal';
    modal.innerHTML = `
      <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="rename-device-title">
        <div class="modal-header"><h3 class="modal-title" id="rename-device-title">${deps.text('renameDevice', 'Rename device')}</h3></div>
        <label style="display:grid;gap:6px;">
          <span>${deps.text('deviceNameLabel', 'Device name')}</span>
          <input type="text" class="form-input" id="rename-device-input" data-testid="rename-device-input" value="${escapeAttr(current.name)}" maxlength="64" autocomplete="off">
        </label>
        <div id="rename-device-error" role="alert" style="color:var(--danger);font-size:0.82em;min-height:1em;margin-top:6px;"></div>
        <div class="modal-actions">
          <button type="button" class="btn" id="rename-device-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="rename-device-save" data-testid="rename-device-save">${deps.text('save', 'Save')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#rename-device-input') as HTMLInputElement;
    const error = modal.querySelector('#rename-device-error') as HTMLElement;
    let deactivate = (): void => {};
    const closeRename = (): void => {
      deactivate();
      modal.remove();
    };
    const save = (): void => {
      try {
        deps.renameDevice(input.value);
        deactivate();
        modal.remove();
        render();
        (overlay.querySelector('#rename-current-device') as HTMLElement | null)?.focus();
      } catch {
        error.textContent = deps.text('deviceNameRequired', 'Enter a device name.');
      }
    };
    modal.querySelector('#rename-device-save')?.addEventListener('click', save);
    input.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') save();
    });
    modal.querySelector('#rename-device-cancel')?.addEventListener('click', closeRename);
    deactivate = activateModalAccessibility(modal, {
      initialFocus: input,
      restoreFocusTo: opener,
      onEscape: closeRename,
    });
    input.select();
  }

  function openLinkStartConfirm(): void {
    const opener = document.activeElement as HTMLElement | null;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'link-device-start-confirm';
    modal.dataset.testid = 'link-device-start-confirm';
    modal.innerHTML = `
      <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="link-device-start-title" aria-describedby="link-device-start-warning">
        <div class="modal-header"><h3 class="modal-title" id="link-device-start-title">${deps.text('linkADevice', 'Link a device')}</h3></div>
        <p id="link-device-start-warning" style="font-size:0.86em;color:var(--text-secondary);">${deps.text('linkPublicCorrelationWarning', 'Linking can publicly reveal that two pseudonymous identities are controlled together. Removing the link later cannot erase copies of the earlier signed relationship.')}</p>
        <p style="font-size:0.82em;color:var(--text-tertiary);">${deps.text('linkedDevicesNoTransfer', 'A direct link does not authorize data transfer, synchronization, recovery, or merged authorship.')}</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="link-device-start-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="link-device-start-continue" data-testid="confirm-generate-link-code">${deps.text('generateLinkCode', 'Generate code')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    let deactivate = (): void => {};
    const cancel = (): void => {
      deactivate();
      modal.remove();
    };
    modal.querySelector('#link-device-start-cancel')?.addEventListener('click', cancel);
    modal.querySelector('#link-device-start-continue')?.addEventListener('click', () => {
      deactivate();
      modal.remove();
      openCodeDialog(opener);
    });
    deactivate = activateModalAccessibility(modal, {
      initialFocus: modal.querySelector('#link-device-start-cancel') as HTMLElement | null,
      restoreFocusTo: opener,
      onEscape: cancel,
    });
  }

  // --- Link-device code dialog (size S) ---------------------------------------
  function openCodeDialog(restoreOpener?: HTMLElement | null): void {
    const opener = restoreOpener ?? document.activeElement as HTMLElement | null;
    const generated = deps.createLinkCode?.(now());
    const payload: PairingPayload = generated?.payload
      ?? createPairingPayload(deps.selfPub(), { randomSecret: deps.randomSecret } as any, now());
    const code = generated?.code ?? encodePairingCode(payload);
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'link-device-code-modal';
    modal.dataset.testid = 'link-device-code-modal';
    modal.innerHTML = `
      <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="link-device-code-title" aria-describedby="link-device-code-help">
        <div class="modal-header"><h3 class="modal-title" id="link-device-code-title">${deps.text('linkADevice', 'Link a device')}</h3></div>
        <p id="link-device-code-help" style="font-size:0.85em;color:var(--text-tertiary);">${deps.text('linkCodeHelp', 'Enter this code on your other device before it expires.')}</p>
        <div data-testid="link-device-code" id="link-device-code" style="font-family:monospace;font-size:0.9em;word-break:break-all;padding:10px;background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;">${escapeHtml(code)}</div>
        <div data-testid="link-device-qr" role="img" aria-label="${deps.text('linkQrCodeLabel', 'QR code containing this pairing code')}" style="margin:10px auto;width:180px;min-height:180px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:#fff;">
          <canvas id="link-device-qr-canvas" width="180" height="180" aria-hidden="true"></canvas>
        </div>
        <div data-testid="link-device-countdown" id="link-device-countdown" role="timer" aria-label="${deps.text('linkCodeTimeRemaining', 'Link code time remaining')}" style="text-align:center;font-size:0.85em;color:var(--text-secondary);"></div>
        <div id="link-device-request-status" data-testid="link-device-request-status" role="status" aria-live="polite" style="font-size:0.84em;color:var(--text-secondary);min-height:1.4em;margin-top:8px;word-break:break-word;">${deps.text('linkWaitingForOtherDevice', 'Waiting for the other device to enter this code.')}</div>
        <div class="modal-actions">
          <button type="button" class="btn" data-testid="link-device-copy" id="link-device-copy">${deps.text('copy', 'Copy')}</button>
          <button type="button" class="btn primary-btn" data-testid="link-device-check-request" id="link-device-check-request">${deps.text('checkForLinkRequest', 'Check for request')}</button>
          <button type="button" class="btn primary-btn" id="link-device-done">${deps.text('done', 'Done')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const qrCanvas = modal.querySelector('#link-device-qr-canvas') as HTMLCanvasElement;
    void renderLinkCodeQr(qrCanvas, code).catch(() => {
      const holder = modal.querySelector('[data-testid="link-device-qr"]');
      if (holder) holder.textContent = deps.text('linkQrRenderFailed', 'Could not render QR code. Use Copy instead.');
    });

    const countdownEl = modal.querySelector('#link-device-countdown') as HTMLElement;
    const requestStatus = modal.querySelector('#link-device-request-status') as HTMLElement;
    let deactivate = (): void => {};
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
    const closeCode = (cancelPending = true): void => {
      window.clearInterval(timer);
      if (cancelPending) deps.cancelPendingRequest?.(payload.requestId);
      deactivate();
      modal.remove();
    };
    modal.querySelector('#link-device-check-request')?.addEventListener('click', async () => {
      const checkButton = modal.querySelector('#link-device-check-request') as HTMLButtonElement | null;
      if (checkButton) checkButton.disabled = true;
      requestStatus.textContent = deps.text('checkingForLinkRequest', 'Checking…');
      const request = await deps.readIncomingRequest?.().catch(() => null) ?? null;
      if (!modal.isConnected) return;
      if (!request) {
        requestStatus.textContent = deps.text('linkWaitingForOtherDevice', 'Waiting for the other device to enter this code.');
        if (checkButton) checkButton.disabled = false;
        return;
      }
      requestStatus.innerHTML = `${deps.text('linkApprovalPrompt', 'Approve a direct identity link with')} <strong>${escapeHtml(formatIdentityFingerprint(request.peerPub))}</strong>?<br><span style="font-size:0.92em;color:var(--text-tertiary);">${deps.text('linkPublicCorrelationWarning', 'Linking can publicly reveal that two pseudonymous identities are controlled together. Removing the link later cannot erase copies of the earlier signed relationship.')}</span>`;
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn primary-btn';
      approve.dataset.testid = 'approve-link-request';
      approve.textContent = deps.text('approveLinkRequest', 'Approve link');
      approve.style.marginTop = '8px';
      requestStatus.append(document.createElement('br'), approve);
      approve.focus();
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        const approved = await deps.approveIncomingRequest?.(request.peerPub).catch(() => false) ?? false;
        if (!approved) {
          requestStatus.textContent = deps.text('linkApprovalFailed', 'Could not verify and approve this request.');
          if (checkButton) checkButton.disabled = false;
          return;
        }
        requestStatus.textContent = deps.text('linkApprovalComplete', 'Direct identity link verified.');
        closeCode(false);
        render();
        (overlay.querySelector('#link-a-device-btn') as HTMLElement | null)?.focus();
      });
    });
    modal.querySelector('#link-device-done')?.addEventListener('click', () => closeCode());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCode();
    });
    deactivate = activateModalAccessibility(modal, {
      initialFocus: modal.querySelector('#link-device-copy') as HTMLElement | null,
      restoreFocusTo: opener,
      onEscape: closeCode,
    });
  }

  // --- Enter link code dialog (size S) ----------------------------------------
  function openEnterCodeDialog(): void {
    const opener = document.activeElement as HTMLElement | null;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'enter-link-code-modal';
    modal.dataset.testid = 'enter-link-code-modal';
    modal.innerHTML = `
      <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="enter-link-code-title">
        <div class="modal-header"><h3 class="modal-title" id="enter-link-code-title">${deps.text('enterLinkCode', 'Enter link code')}</h3></div>
        <label for="enter-link-code-input" class="visually-hidden">${deps.text('linkCodeInputLabel', 'Link code')}</label>
        <input type="text" class="form-input" id="enter-link-code-input" data-testid="enter-link-code-input" aria-describedby="enter-link-code-error" placeholder="${deps.text('linkCodePlaceholder', 'Paste link code')}" autocomplete="off" style="width:100%;">
        <div id="enter-link-peer-preview" data-testid="enter-link-peer-preview" hidden style="font-size:0.84em;color:var(--text-secondary);margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:8px;"></div>
        <div id="enter-link-code-error" data-testid="enter-link-code-error" role="alert" aria-live="assertive" style="color:var(--danger);font-size:0.82em;min-height:1em;margin-top:6px;"></div>
        <video id="link-code-camera-preview" data-testid="link-code-camera-preview" hidden style="width:100%;max-height:240px;border-radius:8px;background:#000;object-fit:cover;margin-top:8px;"></video>
        <div id="link-code-camera-status" role="status" aria-live="polite" style="font-size:0.82em;color:var(--text-tertiary);min-height:1em;margin-top:6px;"></div>
        <div class="modal-actions">
          ${isQrCameraScanSupported() ? `<button type="button" class="btn" id="scan-link-code" data-testid="scan-link-code">${deps.text('scanLinkCode', 'Scan with camera')}</button>` : ''}
          <button type="button" class="btn" id="enter-link-code-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="enter-link-code-submit" data-testid="enter-link-code-submit">${deps.text('approveAndLink', 'Approve and link')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const errorEl = modal.querySelector('#enter-link-code-error') as HTMLElement;
    const input = modal.querySelector('#enter-link-code-input') as HTMLInputElement;
    const peerPreview = modal.querySelector('#enter-link-peer-preview') as HTMLElement;
    const cameraStatus = modal.querySelector('#link-code-camera-status') as HTMLElement;
    const cameraPreview = modal.querySelector('#link-code-camera-preview') as HTMLVideoElement;
    let stopScanner = (): void => {};
    let deactivate = (): void => {};
    const renderPeerPreview = (): void => {
      const payload = decodePairingCode(input.value.trim());
      if (!payload || isPairingExpired(payload, now()) || payload.pub === deps.selfPub()) {
        peerPreview.hidden = true;
        peerPreview.textContent = '';
        return;
      }
      peerPreview.hidden = false;
      peerPreview.innerHTML = `${deps.text('linkPeerPreview', 'Identity fingerprint')} <strong>${escapeHtml(formatIdentityFingerprint(payload.pub))}</strong><br><span style="font-size:0.92em;color:var(--text-tertiary);">${deps.text('linkPublicCorrelationWarning', 'Linking can publicly reveal that two pseudonymous identities are controlled together. Removing the link later cannot erase copies of the earlier signed relationship.')}</span>`;
    };
    const cancel = (): void => {
      stopScanner();
      deactivate();
      modal.remove();
    };

    const errorText = (key: 'invalid' | 'expired' | 'reused' | 'self' | 'unavailable'): string =>
      ({
        invalid: deps.text('linkErrorInvalid', 'That code is invalid.'),
        expired: deps.text('linkErrorExpired', 'That code has expired.'),
        reused: deps.text('linkErrorReused', 'That device is already linked.'),
        self: deps.text('linkErrorSelf', 'You cannot link a device to itself.'),
        unavailable: deps.text('linkErrorUnavailable', 'Could not reach the public graph. Try again.'),
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
      const err = await deps.completeFromCode(raw).catch(() => 'unavailable' as const);
      if (err) {
        errorEl.textContent = errorText(err);
        return;
      }
      stopScanner();
      deactivate();
      modal.remove();
      render(); // refresh the list
      (overlay.querySelector('#enter-link-code-btn') as HTMLElement | null)?.focus();
    };

    modal.querySelector('#enter-link-code-submit')?.addEventListener('click', () => void submit());
    input.addEventListener('input', renderPeerPreview);
    modal.querySelector('#scan-link-code')?.addEventListener('click', async () => {
      const scanButton = modal.querySelector('#scan-link-code') as HTMLButtonElement | null;
      if (scanButton) scanButton.disabled = true;
      cameraPreview.hidden = false;
      cameraStatus.textContent = deps.text('cameraPermissionPrompt', 'Allow camera access to scan the QR code.');
      try {
        stopScanner = await startQrCameraScan(cameraPreview, (scannedCode) => {
          input.value = scannedCode;
          renderPeerPreview();
          cameraPreview.hidden = true;
          cameraStatus.textContent = deps.text('linkCodeScanned', 'Code scanned. Review it, then press Link.');
          (modal.querySelector('#enter-link-code-submit') as HTMLElement | null)?.focus();
        });
        cameraStatus.textContent = deps.text('cameraScanningQr', 'Point the camera at the QR code.');
      } catch {
        cameraPreview.hidden = true;
        cameraStatus.textContent = deps.text('cameraScanFailed', 'Camera scanning is unavailable. Paste the code instead.');
        if (scanButton) scanButton.disabled = false;
      }
    });
    input.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') void submit();
    });
    modal.querySelector('#enter-link-code-cancel')?.addEventListener('click', cancel);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cancel();
    });
    deactivate = activateModalAccessibility(modal, {
      initialFocus: input,
      restoreFocusTo: opener,
      onEscape: cancel,
    });
  }

  // --- Unlink confirm (size S) ------------------------------------------------
  function openUnlinkConfirm(pub: string): void {
    const row = deps.listRecords().find((r) => r.pub === pub);
    const opener = document.activeElement as HTMLElement | null;
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'unlink-device-confirm';
    modal.dataset.testid = 'unlink-device-confirm';
    modal.innerHTML = `
      <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="unlink-device-title" aria-describedby="unlink-device-consequences">
        <div class="modal-header"><h3 class="modal-title" id="unlink-device-title">${deps.text('unlinkTitle', 'Remove link')}</h3></div>
        <p>${deps.text('unlinkConfirm', 'Remove the link to')} <strong>${escapeHtml(row?.stageName || 'this device')}</strong>?</p>
        <p id="unlink-device-consequences" style="font-size:0.82em;color:var(--text-tertiary);">${deps.text('unlinkConsequences', 'This stops future trust through this link. It does not erase that device, delete its local data, recall public records, or hide the earlier relationship.')}</p>
        <div class="modal-actions">
          <button type="button" class="btn" id="unlink-cancel">${deps.text('cancel', 'Cancel')}</button>
          <button type="button" class="btn primary-btn" id="unlink-confirm-btn" data-testid="unlink-confirm-btn">${deps.text('removeLink', 'Remove link')}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    let deactivate = (): void => {};
    const cancel = (): void => {
      deactivate();
      modal.remove();
    };
    modal.querySelector('#unlink-cancel')?.addEventListener('click', cancel);
    modal.querySelector('#unlink-confirm-btn')?.addEventListener('click', async () => {
      await deps.unlink(pub);
      deactivate();
      modal.remove();
      render();
      (overlay.querySelector('#link-a-device-btn') as HTMLElement | null)?.focus();
    });
    deactivate = activateModalAccessibility(modal, {
      initialFocus: modal.querySelector('#unlink-cancel') as HTMLElement | null,
      restoreFocusTo: opener,
      onEscape: cancel,
    });
  }

  document.body.appendChild(overlay);
  render();
  deactivatePageAccessibility = activateModalAccessibility(overlay, {
    initialFocus: overlay.querySelector('#linked-devices-close') as HTMLElement | null,
    restoreFocusTo: pageOpener,
    onEscape: close,
  });
  if (deps.refreshRecords) {
    void deps.refreshRecords().then(() => {
      if (!overlay.isConnected) return;
      render();
      (overlay.querySelector('#linked-devices-close') as HTMLElement | null)?.focus();
    });
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export { PAIRING_TTL_MS };
