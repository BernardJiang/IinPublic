/** @jest-environment jsdom */

import { showLinkedDevicesDialog } from '../../web/ui/linked-devices-dialog';

describe('linked devices dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
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
