import { IDENTITY_PASSWORD_MIN_CODE_POINTS } from '../../shared/identity-password-custody';
import { formatIdentityFingerprint } from '../services/local-device-metadata';
import { activateModalAccessibility } from './modal-accessibility';
import { showEraseDeviceDialog } from './erase-device-dialog';

type TextLookup = (key: string, fallback?: string) => string;

export interface IdentityUnlockDialogDeps {
  text: TextLookup;
  publicIdentity: string;
  onUnlock: (password: string) => Promise<void>;
  onErase: () => Promise<void> | void;
}

export interface SetIdentityPasswordDialogDeps {
  text: TextLookup;
  onSet: (password: string) => Promise<void>;
}

export interface ChangeIdentityPasswordDialogDeps {
  text: TextLookup;
  onChange: (currentPassword: string, newPassword: string) => Promise<void>;
}

export interface RemoveIdentityPasswordDialogDeps {
  text: TextLookup;
  onRemove: (currentPassword: string) => Promise<void>;
}

function setPasswordVisibility(inputs: HTMLInputElement[], visible: boolean): void {
  for (const input of inputs) input.type = visible ? 'text' : 'password';
}

function genericError(error: unknown, fallback: string): string {
  if (error instanceof Error && /at least 15|no more than 1024|invalid Unicode/i.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export function showIdentityUnlockDialog(deps: IdentityUnlockDialogDeps): Promise<void> {
  document.getElementById('identity-unlock-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'identity-unlock-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'identity-unlock-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="identity-unlock-title" aria-describedby="identity-unlock-help identity-unlock-reset-warning">
      <div class="modal-header"><h2 class="modal-title" id="identity-unlock-title">${deps.text('identityUnlockTitle', 'Unlock your identity')}</h2></div>
      <p id="identity-unlock-help" style="font-size:0.86em;color:var(--text-secondary);">${deps.text('identityUnlockHelp', 'Enter the local identity password for this device.')}</p>
      <div data-testid="identity-unlock-fingerprint" style="font-family:monospace;font-size:0.82em;padding:8px;background:var(--bg-subtle);border-radius:8px;">${formatIdentityFingerprint(deps.publicIdentity)}</div>
      <form id="identity-unlock-form" style="display:grid;gap:10px;margin-top:12px;">
        <label style="display:grid;gap:5px;">
          <span>${deps.text('identityPasswordLabel', 'Identity password')}</span>
          <input type="password" class="form-input" id="identity-unlock-password" data-testid="identity-unlock-password" autocomplete="current-password" required>
        </label>
        <label style="display:flex;align-items:center;gap:7px;font-size:0.84em;">
          <input type="checkbox" id="identity-unlock-show-password"> ${deps.text('showPassword', 'Show password')}
        </label>
        <div id="identity-unlock-error" data-testid="identity-unlock-error" role="alert" aria-live="assertive" style="color:var(--danger);font-size:0.84em;min-height:1.2em;"></div>
        <button type="submit" class="btn primary-btn" id="identity-unlock-submit" data-testid="identity-unlock-submit">${deps.text('unlockIdentity', 'Unlock identity')}</button>
      </form>
      <button type="button" class="btn" id="identity-forgot-password" data-testid="identity-forgot-password" style="margin-top:10px;width:100%;">${deps.text('forgotIdentityPassword', "Why can't this password be reset?")}</button>
      <div id="identity-unlock-reset-warning" data-testid="identity-unlock-reset-warning" hidden style="font-size:0.82em;color:var(--warning-text);margin-top:10px;padding:10px;border:1px solid var(--warning);border-radius:8px;">
        <p style="margin:0 0 8px;">${deps.text('identityPasswordNoReset', 'IinPublic cannot reset this password. If you forgot it, the only option on this device is to erase local data and start over with a different identity.')}</p>
        <button type="button" class="btn" id="identity-unlock-erase" data-testid="identity-unlock-erase" style="color:var(--danger);">${deps.text('eraseAndStartOver', 'Erase and start over')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const form = overlay.querySelector('#identity-unlock-form') as HTMLFormElement;
  const input = overlay.querySelector('#identity-unlock-password') as HTMLInputElement;
  const submit = overlay.querySelector('#identity-unlock-submit') as HTMLButtonElement;
  const error = overlay.querySelector('#identity-unlock-error') as HTMLElement;
  const show = overlay.querySelector('#identity-unlock-show-password') as HTMLInputElement;
  const resetWarning = overlay.querySelector('#identity-unlock-reset-warning') as HTMLElement;
  let deactivate = (): void => {};

  return new Promise<void>((resolve) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const password = input.value;
      input.value = '';
      error.textContent = '';
      submit.disabled = true;
      submit.textContent = deps.text('unlockingIdentity', 'Unlocking…');
      try {
        await deps.onUnlock(password);
        deactivate();
        overlay.remove();
        resolve();
      } catch {
        error.textContent = deps.text('identityUnlockFailed', 'Could not unlock. Check the password and try again.');
        submit.disabled = false;
        submit.textContent = deps.text('unlockIdentity', 'Unlock identity');
        input.focus();
      }
    });
    show.addEventListener('change', () => setPasswordVisibility([input], show.checked));
    overlay.querySelector('#identity-forgot-password')?.addEventListener('click', () => {
      resetWarning.hidden = !resetWarning.hidden;
      if (!resetWarning.hidden) (overlay.querySelector('#identity-unlock-erase') as HTMLElement | null)?.focus();
    });
    overlay.querySelector('#identity-unlock-erase')?.addEventListener('click', () => {
      showEraseDeviceDialog({
        text: deps.text,
        hasLinkedDevice: false,
        onErase: deps.onErase,
      });
    });
    deactivate = activateModalAccessibility(overlay, {
      initialFocus: input,
      onEscape: () => input.focus(),
    });
  });
}

export function showSetIdentityPasswordDialog(deps: SetIdentityPasswordDialogDeps): Promise<boolean> {
  document.getElementById('set-identity-password-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'set-identity-password-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'set-identity-password-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="set-identity-password-title" aria-describedby="set-identity-password-warning">
      <div class="modal-header"><h3 class="modal-title" id="set-identity-password-title">${deps.text('setIdentityPassword', 'Set identity password')}</h3></div>
      <p id="set-identity-password-warning" style="font-size:0.86em;color:var(--warning-text);">${deps.text('identityPasswordPermanentWarning', 'IinPublic does not store your password or identity on a recovery server. No one—including IinPublic—can recover or reset this password. If you forget it, this device\'s identity and local encrypted data may become permanently inaccessible. A linked device cannot unlock this one. You can erase this device and start over, but that will not recover the old identity.')}</p>
      <form id="set-identity-password-form" style="display:grid;gap:10px;">
        <label style="display:grid;gap:5px;"><span>${deps.text('newIdentityPassword', 'New identity password')}</span><input type="password" class="form-input" id="set-identity-password" data-testid="set-identity-password" autocomplete="new-password" required></label>
        <label style="display:grid;gap:5px;"><span>${deps.text('confirmIdentityPassword', 'Confirm identity password')}</span><input type="password" class="form-input" id="confirm-identity-password" data-testid="confirm-identity-password" autocomplete="new-password" required></label>
        <p style="font-size:0.8em;color:var(--text-tertiary);margin:0;">${deps.text('identityPasswordStrengthGuidance', 'Use at least 15 characters. Spaces and any language are allowed.')}</p>
        <label style="display:flex;align-items:flex-start;gap:7px;font-size:0.84em;"><input type="checkbox" id="identity-password-warning-ack" data-testid="identity-password-warning-ack"> <span>${deps.text('identityPasswordWarningAck', 'I understand that this password cannot be recovered or reset')}</span></label>
        <label style="display:flex;align-items:center;gap:7px;font-size:0.84em;"><input type="checkbox" id="set-identity-show-password"> ${deps.text('showPassword', 'Show password')}</label>
        <div id="set-identity-password-error" data-testid="set-identity-password-error" role="alert" aria-live="assertive" style="color:var(--danger);font-size:0.84em;min-height:1.2em;"></div>
        <div class="modal-actions"><button type="button" class="btn" id="set-identity-password-cancel">${deps.text('cancel', 'Cancel')}</button><button type="submit" class="btn primary-btn" id="set-identity-password-submit" data-testid="set-identity-password-submit" disabled>${deps.text('setPassword', 'Set password')}</button></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('#set-identity-password-form') as HTMLFormElement;
  const passwordInput = overlay.querySelector('#set-identity-password') as HTMLInputElement;
  const confirmInput = overlay.querySelector('#confirm-identity-password') as HTMLInputElement;
  const acknowledgement = overlay.querySelector('#identity-password-warning-ack') as HTMLInputElement;
  const show = overlay.querySelector('#set-identity-show-password') as HTMLInputElement;
  const submit = overlay.querySelector('#set-identity-password-submit') as HTMLButtonElement;
  const error = overlay.querySelector('#set-identity-password-error') as HTMLElement;
  let deactivate = (): void => {};

  const updateSubmitState = (): void => {
    const password = passwordInput.value;
    submit.disabled =
      !acknowledgement.checked ||
      password !== confirmInput.value ||
      Array.from(password.normalize('NFC')).length < IDENTITY_PASSWORD_MIN_CODE_POINTS;
  };

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean): void => {
      passwordInput.value = '';
      confirmInput.value = '';
      deactivate();
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('#set-identity-password-cancel')?.addEventListener('click', () => close(false));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const password = passwordInput.value;
      const confirmation = confirmInput.value;
      passwordInput.value = '';
      confirmInput.value = '';
      if (!acknowledgement.checked) {
        error.textContent = deps.text('identityPasswordAcknowledgeRequired', 'Acknowledge the no-reset warning first.');
        passwordInput.focus();
        return;
      }
      if (password !== confirmation) {
        error.textContent = deps.text('identityPasswordMismatch', 'The passwords do not match.');
        passwordInput.focus();
        return;
      }
      if (Array.from(password.normalize('NFC')).length < IDENTITY_PASSWORD_MIN_CODE_POINTS) {
        error.textContent = deps.text('identityPasswordTooShort', 'Use at least 15 characters.');
        passwordInput.focus();
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      try {
        await deps.onSet(password);
        close(true);
      } catch (caught) {
        error.textContent = genericError(
          caught,
          deps.text('identityPasswordSetFailed', 'Could not set the identity password. Your existing identity was not changed.'),
        );
        updateSubmitState();
        passwordInput.focus();
      }
    });
    passwordInput.addEventListener('input', updateSubmitState);
    confirmInput.addEventListener('input', updateSubmitState);
    acknowledgement.addEventListener('change', updateSubmitState);
    show.addEventListener('change', () => setPasswordVisibility([passwordInput, confirmInput], show.checked));
    deactivate = activateModalAccessibility(overlay, {
      initialFocus: passwordInput,
      restoreFocusTo: opener,
      onEscape: () => close(false),
    });
  });
}

export function showChangeIdentityPasswordDialog(deps: ChangeIdentityPasswordDialogDeps): Promise<boolean> {
  document.getElementById('change-identity-password-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'change-identity-password-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'change-identity-password-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="change-identity-password-title">
      <div class="modal-header"><h3 class="modal-title" id="change-identity-password-title">${deps.text('changeIdentityPassword', 'Change identity password')}</h3></div>
      <form id="change-identity-password-form" style="display:grid;gap:10px;">
        <label style="display:grid;gap:5px;"><span>${deps.text('currentIdentityPassword', 'Current identity password')}</span><input type="password" class="form-input" id="current-identity-password" data-testid="current-identity-password" autocomplete="current-password" required></label>
        <label style="display:grid;gap:5px;"><span>${deps.text('newIdentityPassword', 'New identity password')}</span><input type="password" class="form-input" id="change-new-identity-password" data-testid="change-new-identity-password" autocomplete="new-password" required></label>
        <label style="display:grid;gap:5px;"><span>${deps.text('confirmIdentityPassword', 'Confirm identity password')}</span><input type="password" class="form-input" id="change-confirm-identity-password" data-testid="change-confirm-identity-password" autocomplete="new-password" required></label>
        <label style="display:flex;align-items:center;gap:7px;font-size:0.84em;"><input type="checkbox" id="change-identity-show-password"> ${deps.text('showPassword', 'Show password')}</label>
        <div id="change-identity-password-error" data-testid="change-identity-password-error" role="alert" aria-live="assertive" style="color:var(--danger);font-size:0.84em;min-height:1.2em;"></div>
        <div class="modal-actions"><button type="button" class="btn" id="change-identity-password-cancel">${deps.text('cancel', 'Cancel')}</button><button type="submit" class="btn primary-btn" id="change-identity-password-submit" data-testid="change-identity-password-submit">${deps.text('changePassword', 'Change password')}</button></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('#change-identity-password-form') as HTMLFormElement;
  const currentInput = overlay.querySelector('#current-identity-password') as HTMLInputElement;
  const nextInput = overlay.querySelector('#change-new-identity-password') as HTMLInputElement;
  const confirmInput = overlay.querySelector('#change-confirm-identity-password') as HTMLInputElement;
  const show = overlay.querySelector('#change-identity-show-password') as HTMLInputElement;
  const submit = overlay.querySelector('#change-identity-password-submit') as HTMLButtonElement;
  const error = overlay.querySelector('#change-identity-password-error') as HTMLElement;
  let deactivate = (): void => {};

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean): void => {
      currentInput.value = '';
      nextInput.value = '';
      confirmInput.value = '';
      deactivate();
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('#change-identity-password-cancel')?.addEventListener('click', () => close(false));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const currentPassword = currentInput.value;
      const newPassword = nextInput.value;
      const confirmation = confirmInput.value;
      currentInput.value = '';
      nextInput.value = '';
      confirmInput.value = '';
      if (newPassword !== confirmation) {
        error.textContent = deps.text('identityPasswordMismatch', 'The passwords do not match.');
        currentInput.focus();
        return;
      }
      if (Array.from(newPassword.normalize('NFC')).length < IDENTITY_PASSWORD_MIN_CODE_POINTS) {
        error.textContent = deps.text('identityPasswordTooShort', 'Use at least 15 characters.');
        currentInput.focus();
        return;
      }
      submit.disabled = true;
      error.textContent = '';
      try {
        await deps.onChange(currentPassword, newPassword);
        close(true);
      } catch {
        error.textContent = deps.text('identityPasswordChangeFailed', 'Could not change the password. Check the current password and try again.');
        submit.disabled = false;
        currentInput.focus();
      }
    });
    show.addEventListener('change', () => {
      setPasswordVisibility([currentInput, nextInput, confirmInput], show.checked);
    });
    deactivate = activateModalAccessibility(overlay, {
      initialFocus: currentInput,
      restoreFocusTo: opener,
      onEscape: () => close(false),
    });
  });
}

export function showRemoveIdentityPasswordDialog(deps: RemoveIdentityPasswordDialogDeps): Promise<boolean> {
  document.getElementById('remove-identity-password-overlay')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.id = 'remove-identity-password-overlay';
  overlay.className = 'modal-overlay';
  overlay.dataset.testid = 'remove-identity-password-overlay';
  overlay.innerHTML = `
    <div class="modal-content size-s" role="dialog" aria-modal="true" aria-labelledby="remove-identity-password-title" aria-describedby="remove-identity-password-warning">
      <div class="modal-header"><h3 class="modal-title" id="remove-identity-password-title">${deps.text('removeIdentityPassword', 'Remove identity password')}</h3></div>
      <p id="remove-identity-password-warning" data-testid="remove-identity-password-warning" style="font-size:0.86em;color:var(--warning-text);">${deps.text('removeIdentityPasswordWarning', "Removing your password makes this identity open automatically on this device. Browser storage will contain everything needed to unlock it. Anyone who can copy or access this browser's local data may be able to use your identity. This does not delete your identity or data.")}</p>
      <form id="remove-identity-password-form" style="display:grid;gap:10px;">
        <label style="display:grid;gap:5px;"><span>${deps.text('currentIdentityPassword', 'Current identity password')}</span><input type="password" class="form-input" id="remove-current-identity-password" data-testid="remove-current-identity-password" autocomplete="current-password" required></label>
        <label style="display:flex;align-items:flex-start;gap:7px;font-size:0.84em;"><input type="checkbox" id="remove-identity-password-ack" data-testid="remove-identity-password-ack"> <span>${deps.text('removeIdentityPasswordAck', 'I understand that removing the password reduces protection on this device.')}</span></label>
        <label style="display:flex;align-items:center;gap:7px;font-size:0.84em;"><input type="checkbox" id="remove-identity-show-password"> ${deps.text('showPassword', 'Show password')}</label>
        <div id="remove-identity-password-error" data-testid="remove-identity-password-error" role="alert" aria-live="assertive" style="color:var(--danger);font-size:0.84em;min-height:1.2em;"></div>
        <div class="modal-actions"><button type="button" class="btn" id="remove-identity-password-cancel">${deps.text('cancel', 'Cancel')}</button><button type="submit" class="btn" id="remove-identity-password-submit" data-testid="remove-identity-password-submit" style="color:var(--danger);" disabled>${deps.text('removePassword', 'Remove password')}</button></div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  const form = overlay.querySelector('#remove-identity-password-form') as HTMLFormElement;
  const passwordInput = overlay.querySelector('#remove-current-identity-password') as HTMLInputElement;
  const acknowledgement = overlay.querySelector('#remove-identity-password-ack') as HTMLInputElement;
  const show = overlay.querySelector('#remove-identity-show-password') as HTMLInputElement;
  const submit = overlay.querySelector('#remove-identity-password-submit') as HTMLButtonElement;
  const error = overlay.querySelector('#remove-identity-password-error') as HTMLElement;
  let deactivate = (): void => {};
  const updateSubmitState = (): void => {
    submit.disabled = !acknowledgement.checked || passwordInput.value.length === 0;
  };

  return new Promise<boolean>((resolve) => {
    const close = (result: boolean): void => {
      passwordInput.value = '';
      deactivate();
      overlay.remove();
      resolve(result);
    };
    overlay.querySelector('#remove-identity-password-cancel')?.addEventListener('click', () => close(false));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      const currentPassword = passwordInput.value;
      passwordInput.value = '';
      submit.disabled = true;
      error.textContent = '';
      try {
        await deps.onRemove(currentPassword);
        close(true);
      } catch {
        error.textContent = deps.text(
          'identityPasswordRemoveFailed',
          'Could not remove the password. Check the current password and try again.',
        );
        updateSubmitState();
        passwordInput.focus();
      }
    });
    passwordInput.addEventListener('input', updateSubmitState);
    acknowledgement.addEventListener('change', updateSubmitState);
    show.addEventListener('change', () => setPasswordVisibility([passwordInput], show.checked));
    deactivate = activateModalAccessibility(overlay, {
      initialFocus: passwordInput,
      restoreFocusTo: opener,
      onEscape: () => close(false),
    });
  });
}
