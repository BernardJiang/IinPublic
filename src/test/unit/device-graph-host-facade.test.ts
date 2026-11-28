import { DeviceGraphHostFacade } from '../../web/app/device-graph-host-facade';

describe('DeviceGraphHostFacade', () => {
  it('returns safe empty views before a core connects', async () => {
    const facade = new DeviceGraphHostFacade({ applyTabSnapshot: jest.fn() });
    await expect(facade.conversationMessages('conv')).resolves.toEqual([]);
    await expect(facade.deletedAt('talk')).resolves.toBeNull();
    await expect(facade.talkStats(['talk'])).resolves.toEqual({
      talk: { responses: 0, matches: 0, ignores: 0 },
    });
  });

  it('normalizes graph outcomes into live Talk stats', async () => {
    const facade = new DeviceGraphHostFacade({ applyTabSnapshot: jest.fn() });
    facade.connect(jest.fn(async () => ({ talk: { a: 'matched', b: 'ignored', c: 'mismatched' } })));
    await expect(facade.talkStats(['talk'])).resolves.toEqual({
      talk: { responses: 3, matches: 1, ignores: 1 },
    });
  });

  it('drops an older stats read that resolves after a newer one', async () => {
    let release!: (value: unknown) => void;
    const first = new Promise((resolve) => { release = resolve; });
    const request = jest.fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ newer: { a: 'matched' } });
    const facade = new DeviceGraphHostFacade({ applyTabSnapshot: jest.fn() });
    facade.connect(request);
    const older = facade.talkStats(['older']);
    await expect(facade.talkStats(['newer'])).resolves.toEqual({ newer: { responses: 1, matches: 1, ignores: 0 } });
    release({ older: { a: 'matched' } });
    await expect(older).resolves.toBeNull();
  });

  it('coalesces snapshot requests into one trailing read', async () => {
    let release!: (value: unknown) => void;
    const first = new Promise((resolve) => { release = resolve; });
    const request = jest.fn().mockImplementationOnce(() => first).mockResolvedValueOnce({ version: 2 });
    const apply = jest.fn();
    const facade = new DeviceGraphHostFacade({ applyTabSnapshot: apply, repeatGapMs: 0 });
    facade.connect(request);
    const a = facade.refreshTabSnapshot();
    const b = facade.refreshTabSnapshot();
    release({ version: 1 });
    await Promise.all([a, b]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith({ version: 2 });
  });
});
