/** @jest-environment jsdom */

// TODO §I — loopback same-device shortcut: mocked so tests control reachability
// deterministically instead of depending on a real local server.
jest.mock('../../web/services/loopback-probe', () => ({
  ...jest.requireActual('../../web/services/loopback-probe'),
  probeLoopbackNode: jest.fn(),
}));

import { showLinkedDevicesDialog, type LinkedDevicesDeps } from '../../web/ui/linked-devices-dialog';
import { probeLoopbackNode } from '../../web/services/loopback-probe';
import { createPairingPayload, encodePairingCode, type LinkCrypto } from '../../shared/identity-linking';

const mockedProbeLoopbackNode = probeLoopbackNode as jest.MockedFunction<typeof probeLoopbackNode>;

const crypto: LinkCrypto = {
  sign: async () => 'sig',
  verify: async () => true,
  hash: async () => 'hash',
  randomSecret: () => 'secret-value',
};

function baseDeps(overrides: Partial<LinkedDevicesDeps> = {}): LinkedDevicesDeps {
  return {
    text: (_key, fallback) => fallback || '',
    listRecords: () => [],
    identity: { pub: 'pub-self', stageName: 'Alice', createdAt: Date.now(), status: 'available' },
    device: () => ({ schemaVersion: 1, name: 'This browser', platform: 'browser', createdAt: Date.now() }),
    appVersion: 'test',
    renameDevice: (name) => ({ schemaVersion: 1, name, platform: 'browser', createdAt: Date.now() }),
    randomSecret: () => 'secret',
    selfPub: () => 'pub-self',
    completeFromCode: async () => null,
    unlink: async () => 'removed',
    ...overrides,
  };
}

describe('linked devices dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    mockedProbeLoopbackNode.mockReset();
  });

  it('keeps the close button stable while the background record refresh resolves', async () => {
    let finishRefresh: (() => void) | undefined;
    const refreshRecords = jest.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));
    let records: Array<{
      pub: string;
      stageName: string;
      platform: string;
      linkedAt: number;
      state: 'linked';
    }> = [];

    showLinkedDevicesDialog({
      text: (_key, fallback) => fallback || '',
      listRecords: () => records,
      identity: {
        pub: 'pub-self',
        stageName: 'Alice',
        createdAt: Date.now(),
        status: 'available',
      },
      device: () => ({ schemaVersion: 1, name: 'This browser', platform: 'browser', createdAt: Date.now() }),
      appVersion: 'test',
      renameDevice: (name) => ({ schemaVersion: 1, name, platform: 'browser', createdAt: Date.now() }),
      randomSecret: () => 'secret',
      selfPub: () => 'pub-self',
      refreshRecords,
      completeFromCode: async () => null,
      unlink: async () => 'removed',
    });

    const closeBeforeRefresh = document.getElementById('linked-devices-close');
    expect(closeBeforeRefresh).not.toBeNull();

    records = [{
      pub: 'pub-peer',
      stageName: 'Second device',
      platform: 'browser',
      linkedAt: Date.now(),
      state: 'linked',
    }];
    finishRefresh?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(document.getElementById('linked-devices-close')).toBe(closeBeforeRefresh);
    expect(document.querySelectorAll('[data-testid="linked-device-row"]')).toHaveLength(1);

    closeBeforeRefresh?.click();
    expect(document.getElementById('linked-devices-overlay')).toBeNull();
  });
});

describe('linked devices dialog — URL-fragment prefill (TODO §I)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    mockedProbeLoopbackNode.mockReset();
  });

  it('opens the Enter-code dialog pre-filled and shows the peer preview when prefillLinkCode is given', async () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    const payload = createPairingPayload('pub-peer', crypto);
    const code = encodePairingCode(payload);

    showLinkedDevicesDialog(baseDeps(), { prefillLinkCode: code });

    expect(document.getElementById('enter-link-code-modal')).not.toBeNull();
    const input = document.getElementById('enter-link-code-input') as HTMLInputElement;
    expect(input.value).toBe(code);
    const preview = document.getElementById('enter-link-peer-preview') as HTMLElement;
    expect(preview.hidden).toBe(false);
  });

  it('does not open the Enter-code dialog when no prefill code is given', () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    showLinkedDevicesDialog(baseDeps());
    expect(document.getElementById('enter-link-code-modal')).toBeNull();
  });
});

describe('linked devices dialog — clipboard shortcuts (TODO §I)', () => {
  const originalClipboard = (navigator as any).clipboard;

  afterEach(() => {
    document.body.innerHTML = '';
    mockedProbeLoopbackNode.mockReset();
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  });

  it('Paste button reads the clipboard, fills the input, and shows the peer preview', async () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    const payload = createPairingPayload('pub-peer', crypto);
    const code = encodePairingCode(payload);
    const readText = jest.fn().mockResolvedValue(code);
    Object.defineProperty(navigator, 'clipboard', {
      value: { readText, writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    });

    showLinkedDevicesDialog(baseDeps());
    document.getElementById('enter-link-code-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const pasteBtn = document.getElementById('paste-link-code');
    expect(pasteBtn).not.toBeNull();
    pasteBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    const input = document.getElementById('enter-link-code-input') as HTMLInputElement;
    expect(input.value).toBe(code);
    const preview = document.getElementById('enter-link-peer-preview') as HTMLElement;
    expect(preview.hidden).toBe(false);
  });

  it('hides the Paste button when the clipboard read API is unavailable', () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn() },
      configurable: true,
    });
    showLinkedDevicesDialog(baseDeps());
    document.getElementById('enter-link-code-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('paste-link-code')).toBeNull();
  });

  it('Copy link copies a #link=<code> URL, not the bare code', async () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText, readText: jest.fn() },
      configurable: true,
    });

    showLinkedDevicesDialog(baseDeps());
    document.getElementById('link-a-device-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('[data-testid="confirm-generate-link-code"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const code = document.getElementById('link-device-code')?.textContent || '';
    expect(code).not.toBe('');
    document.getElementById('link-device-copy-link')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`#link=${code}`));
  });
});

describe('linked devices dialog — loopback shortcut (TODO §I)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    mockedProbeLoopbackNode.mockReset();
  });

  it('shows the "link with the app on this computer" button once the loopback probe resolves reachable', async () => {
    mockedProbeLoopbackNode.mockResolvedValue(true);
    showLinkedDevicesDialog(baseDeps());
    document.getElementById('link-a-device-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('[data-testid="confirm-generate-link-code"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const loopbackBtn = document.getElementById('link-device-loopback') as HTMLButtonElement;
    expect(loopbackBtn).not.toBeNull();
    expect(loopbackBtn.hidden).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(loopbackBtn.hidden).toBe(false);
  });

  it('keeps the loopback button hidden when no local node is reachable', async () => {
    mockedProbeLoopbackNode.mockResolvedValue(false);
    showLinkedDevicesDialog(baseDeps());
    document.getElementById('link-a-device-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('[data-testid="confirm-generate-link-code"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const loopbackBtn = document.getElementById('link-device-loopback') as HTMLButtonElement;
    await Promise.resolve();
    await Promise.resolve();
    expect(loopbackBtn.hidden).toBe(true);
  });
});
