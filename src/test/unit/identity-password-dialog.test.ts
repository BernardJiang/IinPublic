/** @jest-environment jsdom */

import {
  showChangeIdentityPasswordDialog,
  showIdentityUnlockDialog,
  showRemoveIdentityPasswordDialog,
  showSetIdentityPasswordDialog,
} from '../../web/ui/identity-password-dialog';

const text = (_key: string, fallback?: string): string => fallback ?? _key;
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('identity password dialogs', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="opener">Open</button>';
    localStorage.clear();
  });

  test('startup unlock cannot be dismissed and reports one generic retry error', async () => {
    const onUnlock = jest.fn(async (password: string) => {
      if (password !== 'correct horse battery staple') throw new Error('secret internal detail');
    });
    const unlocked = showIdentityUnlockDialog({
      text,
      publicIdentity: 'public-signing-key',
      onUnlock,
      onErase: jest.fn(),
    });
    const overlay = document.getElementById('identity-unlock-overlay') as HTMLElement;
    const input = document.getElementById('identity-unlock-password') as HTMLInputElement;
    const form = document.getElementById('identity-unlock-form') as HTMLFormElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.getElementById('identity-unlock-overlay')).toBe(overlay);
    expect(document.getElementById('identity-forgot-password')?.textContent).toBe(
      "Why can't this password be reset?",
    );
    expect(overlay.textContent).not.toContain('Forgot password?');

    input.value = 'incorrect password value';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(input.value).toBe('');
    await flush();
    expect(document.getElementById('identity-unlock-error')?.textContent).toBe(
      'Could not unlock. Check the password and try again.',
    );
    expect(document.body.textContent).not.toContain('secret internal detail');

    input.value = 'correct horse battery staple';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await unlocked;
    expect(document.getElementById('identity-unlock-overlay')).toBeNull();
    expect(onUnlock).toHaveBeenCalledTimes(2);
    expect(localStorage.length).toBe(0);
  });

  test('set-password requires the permanent-loss acknowledgement and matching input', async () => {
    const onSet = jest.fn(async () => undefined);
    const result = showSetIdentityPasswordDialog({ text, onSet });
    const password = document.getElementById('set-identity-password') as HTMLInputElement;
    const confirmation = document.getElementById('confirm-identity-password') as HTMLInputElement;
    const acknowledgement = document.getElementById('identity-password-warning-ack') as HTMLInputElement;
    const form = document.getElementById('set-identity-password-form') as HTMLFormElement;
    const submit = document.getElementById('set-identity-password-submit') as HTMLButtonElement;

    expect(document.getElementById('set-identity-password-warning')?.textContent).toBe(
      "IinPublic does not store your password or identity on a recovery server. No one—including IinPublic—can recover or reset this password. If you forget it, this device's identity and local encrypted data may become permanently inaccessible. A linked device cannot unlock this one. You can erase this device and start over, but that will not recover the old identity.",
    );
    expect(acknowledgement.parentElement?.textContent).toContain(
      'I understand that this password cannot be recovered or reset',
    );
    expect(submit.disabled).toBe(true);

    password.value = 'correct horse battery staple';
    confirmation.value = 'correct horse battery staple';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    confirmation.dispatchEvent(new Event('input', { bubbles: true }));
    expect(submit.disabled).toBe(true);

    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
    password.value = 'correct horse battery staple';
    confirmation.value = 'a different long password';
    confirmation.dispatchEvent(new Event('input', { bubbles: true }));
    expect(submit.disabled).toBe(true);
    expect(onSet).not.toHaveBeenCalled();

    password.value = 'correct horse battery staple';
    confirmation.value = 'correct horse battery staple';
    confirmation.dispatchEvent(new Event('input', { bubbles: true }));
    expect(submit.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expect(result).resolves.toBe(true);
    expect(onSet).toHaveBeenCalledWith('correct horse battery staple');
    expect(document.getElementById('set-identity-password-overlay')).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  test('change-password passes current and new values only after local validation', async () => {
    const onChange = jest.fn(async () => undefined);
    const result = showChangeIdentityPasswordDialog({ text, onChange });
    const current = document.getElementById('current-identity-password') as HTMLInputElement;
    const next = document.getElementById('change-new-identity-password') as HTMLInputElement;
    const confirmation = document.getElementById('change-confirm-identity-password') as HTMLInputElement;
    const form = document.getElementById('change-identity-password-form') as HTMLFormElement;

    current.value = 'correct horse battery staple';
    next.value = 'another strong local password';
    confirmation.value = 'another mismatched password';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(onChange).not.toHaveBeenCalled();

    current.value = 'correct horse battery staple';
    next.value = 'another strong local password';
    confirmation.value = 'another strong local password';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expect(result).resolves.toBe(true);
    expect(onChange).toHaveBeenCalledWith(
      'correct horse battery staple',
      'another strong local password',
    );
    expect(localStorage.length).toBe(0);
  });

  test('remove-password requires the downgrade acknowledgement and clears submitted input', async () => {
    const onRemove = jest.fn(async (password: string) => {
      if (password !== 'correct horse battery staple') throw new Error('secret internal detail');
    });
    const result = showRemoveIdentityPasswordDialog({ text, onRemove });
    const password = document.getElementById('remove-current-identity-password') as HTMLInputElement;
    const acknowledgement = document.getElementById('remove-identity-password-ack') as HTMLInputElement;
    const submit = document.getElementById('remove-identity-password-submit') as HTMLButtonElement;
    const form = document.getElementById('remove-identity-password-form') as HTMLFormElement;

    expect(document.getElementById('remove-identity-password-warning')?.textContent).toContain(
      'Browser storage will contain everything needed to unlock it',
    );
    password.value = 'incorrect current password';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    expect(submit.disabled).toBe(true);
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new Event('change', { bubbles: true }));
    expect(submit.disabled).toBe(false);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(password.value).toBe('');
    await flush();
    expect(document.getElementById('remove-identity-password-error')?.textContent).toContain(
      'Could not remove the password',
    );
    expect(document.body.textContent).not.toContain('secret internal detail');

    password.value = 'correct horse battery staple';
    password.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await expect(result).resolves.toBe(true);
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(document.getElementById('remove-identity-password-overlay')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});
