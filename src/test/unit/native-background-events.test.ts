/** @jest-environment jsdom */

import { readNativeBackgroundEvents } from '../../web/services/native-background-events';

describe('native background event bridge', () => {
  it('returns control before native loopback I/O completes and ignores another request', async () => {
    let requestId = '';
    const bridge = { requestEvents: jest.fn((id: string) => { requestId = id; return true; }) };
    const pending = readNativeBackgroundEvents(bridge);
    expect(bridge.requestEvents).toHaveBeenCalledTimes(1);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    window.dispatchEvent(new CustomEvent('iinpublic-background-agent-events', {
      detail: { id: 'stale', payload: '{"events":[{"id":"wrong"}]}' },
    }));
    expect(settled).toBe(false);
    window.dispatchEvent(new CustomEvent('iinpublic-background-agent-events', {
      detail: { id: requestId, payload: '{"events":[{"id":"fresh"}]}' },
    }));
    await expect(pending).resolves.toEqual([{ id: 'fresh' }]);
  });

  it('settles without a blocking compatibility call when the async native bridge is unavailable', async () => {
    await expect(readNativeBackgroundEvents({})).resolves.toEqual([]);
    await expect(readNativeBackgroundEvents({ requestEvents: () => false })).resolves.toEqual([]);
  });
});
