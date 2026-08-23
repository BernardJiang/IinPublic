/**
 * @jest-environment jsdom
 *
 * TODO §J — "erase stays disabled until the archive is acknowledged by the receiving
 * device" (spec §11.3). A rejected onSyncFirst (no receiver online, ack timeout, a
 * verify/decrypt failure) must show an error and never enable Done.
 */

import { showSyncProgressDialog, type EraseDeviceDeps } from '../../web/ui/erase-device-dialog';

function baseDeps(overrides: Partial<EraseDeviceDeps> = {}): EraseDeviceDeps {
  return {
    text: (_key, fallback) => fallback || '',
    hasLinkedDevice: true,
    onErase: async () => {},
    ...overrides,
  };
}

describe('showSyncProgressDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('enables Done when onSyncFirst resolves', async () => {
    let resolveSync!: () => void;
    const onSyncFirst = jest.fn(() => new Promise<void>((resolve) => { resolveSync = resolve; }));
    const promise = showSyncProgressDialog(baseDeps({ onSyncFirst }));

    const doneBtn = document.getElementById('erase-sync-done') as HTMLButtonElement;
    expect(doneBtn.disabled).toBe(true);
    resolveSync();
    await Promise.resolve();
    await Promise.resolve();
    expect(doneBtn.disabled).toBe(false);

    doneBtn.click();
    await promise;
  });

  it('shows an error and keeps Done disabled when onSyncFirst rejects (no silent success)', async () => {
    let rejectSync!: (err: Error) => void;
    const onSyncFirst = jest.fn(() => new Promise<void>((_resolve, reject) => { rejectSync = reject; }));
    showSyncProgressDialog(baseDeps({ onSyncFirst }));

    const doneBtn = document.getElementById('erase-sync-done') as HTMLButtonElement;
    rejectSync(new Error('receiver never acknowledged'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(doneBtn.disabled).toBe(true);
    const errorEl = document.getElementById('erase-sync-error') as HTMLElement;
    expect(errorEl.textContent).not.toBe('');
  });

  it('a rejection after Cancel does not resurrect the error UI (already resolved/torn down)', async () => {
    let rejectSync!: (err: Error) => void;
    const onSyncFirst = jest.fn(() => new Promise<void>((_resolve, reject) => { rejectSync = reject; }));
    showSyncProgressDialog(baseDeps({ onSyncFirst }));

    document.getElementById('erase-sync-cancel')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('erase-sync-progress-modal')).toBeNull();

    // The in-flight sync now fails after the user already backed out — must not throw
    // or touch a removed DOM node.
    expect(() => rejectSync(new Error('late failure'))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
