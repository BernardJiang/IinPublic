/** @jest-environment jsdom */

jest.mock('../../web/ui/erase-device-dialog', () => ({
  showEraseDeviceDialog: jest.fn(),
}));
jest.mock('../../web/services/device-wipe', () => ({
  eraseDevice: jest.fn().mockResolvedValue(undefined),
}));

import { openEraseDeviceDialog, type EraseDeviceFlowDeps } from '../../web/ui/erase-device-flow';
import { showEraseDeviceDialog as showEraseDeviceDialogMock } from '../../web/ui/erase-device-dialog';
import { eraseDevice as eraseDeviceMock } from '../../web/services/device-wipe';

function deps(overrides: Partial<EraseDeviceFlowDeps> = {}): EraseDeviceFlowDeps {
  return {
    t: (key) => key,
    ...overrides,
  };
}

function setLinkedDevices(rows: Array<{ pub: string; state: string; stageName?: string }>): void {
  localStorage.setItem('iinpublic_linked_devices', JSON.stringify(rows));
}

function capturedOptions() {
  return (showEraseDeviceDialogMock as jest.Mock).mock.calls[0][0];
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
});

describe('openEraseDeviceDialog', () => {
  it('reports no linked device when storage is empty', () => {
    openEraseDeviceDialog(deps());
    const opts = capturedOptions();
    expect(opts.hasLinkedDevice).toBe(false);
    expect(opts.linkedDeviceName).toBeUndefined();
  });

  it('filters out non-"linked" state rows (Removed/Invalid must not count as available)', () => {
    setLinkedDevices([
      { pub: 'p1', state: 'removed', stageName: 'Old Phone' },
      { pub: 'p2', state: 'invalid', stageName: 'Bad Link' },
    ]);
    openEraseDeviceDialog(deps());
    expect(capturedOptions().hasLinkedDevice).toBe(false);
  });

  it('reports the first linked device and its stage name', () => {
    setLinkedDevices([{ pub: 'p1', state: 'linked', stageName: 'My Laptop' }]);
    openEraseDeviceDialog(deps());
    const opts = capturedOptions();
    expect(opts.hasLinkedDevice).toBe(true);
    expect(opts.linkedDeviceName).toBe('My Laptop');
  });

  it('tolerates malformed localStorage JSON by treating it as no linked devices', () => {
    localStorage.setItem('iinpublic_linked_devices', 'not json');
    expect(() => openEraseDeviceDialog(deps())).not.toThrow();
    expect(capturedOptions().hasLinkedDevice).toBe(false);
  });

  it('the text() wrapper falls back to the fallback string when t() echoes the key unchanged', () => {
    openEraseDeviceDialog(deps({ t: (key) => key }));
    const text = capturedOptions().text;
    expect(text('missingKey', 'Fallback text')).toBe('Fallback text');
  });

  it('the text() wrapper uses the translated value when t() actually translates', () => {
    openEraseDeviceDialog(deps({ t: () => 'Translated!' }));
    const text = capturedOptions().text;
    expect(text('anyKey', 'Fallback text')).toBe('Translated!');
  });

  it('onErase wires a revokeLinks hook that calls identityLinkUnlinker for every linked device, best-effort', async () => {
    setLinkedDevices([
      { pub: 'p1', state: 'linked' },
      { pub: 'p2', state: 'linked' },
    ]);
    const unlinker = jest.fn()
      .mockResolvedValueOnce('removed')
      .mockRejectedValueOnce(new Error('offline'));
    openEraseDeviceDialog(deps({ identityLinkUnlinker: unlinker }));
    await capturedOptions().onErase();
    expect(eraseDeviceMock).toHaveBeenCalledTimes(1);

    // eraseDevice itself is mocked, so exercise the revokeLinks hook it was given directly.
    const hooks = (eraseDeviceMock as jest.Mock).mock.calls[0][0];
    await expect(hooks.revokeLinks()).resolves.toBeUndefined();
    expect(unlinker).toHaveBeenCalledWith('p1');
    expect(unlinker).toHaveBeenCalledWith('p2');
  });

  it('onErase still wipes the device when there is no identityLinkUnlinker', async () => {
    setLinkedDevices([{ pub: 'p1', state: 'linked' }]);
    openEraseDeviceDialog(deps());
    await expect(capturedOptions().onErase()).resolves.toBeUndefined();
    expect(eraseDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('omits onSyncFirst when deviceHandoffSync is not configured', () => {
    setLinkedDevices([{ pub: 'p1', state: 'linked' }]);
    openEraseDeviceDialog(deps());
    expect(capturedOptions().onSyncFirst).toBeUndefined();
  });

  it('omits onSyncFirst when there is no linked device even if deviceHandoffSync is configured', () => {
    openEraseDeviceDialog(deps({ deviceHandoffSync: jest.fn() }));
    expect(capturedOptions().onSyncFirst).toBeUndefined();
  });

  it('wires onSyncFirst to deviceHandoffSync with the linked device pub when both are present', () => {
    setLinkedDevices([{ pub: 'p1', state: 'linked' }]);
    const sync = jest.fn().mockResolvedValue(undefined);
    openEraseDeviceDialog(deps({ deviceHandoffSync: sync }));
    const progress = jest.fn();
    capturedOptions().onSyncFirst(progress);
    expect(sync).toHaveBeenCalledWith('p1', progress);
  });
});
