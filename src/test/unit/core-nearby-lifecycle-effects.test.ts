import {
  NearbyLifecycleEffects,
  type NearbyLifecycleEffectsPorts,
} from '../../core/nearby-lifecycle-effects';

type Runtime = { id: string };

const ports = (overrides: Partial<NearbyLifecycleEffectsPorts<Runtime>> = {}) => {
  const value: NearbyLifecycleEffectsPorts<Runtime> = {
    identityKey: jest.fn(() => 'user-1'),
    createRuntime: jest.fn(async (identityKey) => ({ id: identityKey })),
    startRuntime: jest.fn(),
    stopRuntime: jest.fn(),
    refreshRuntime: jest.fn(async () => undefined),
    onEvent: jest.fn(),
    ...overrides,
  };
  return value;
};

describe('NearbyLifecycleEffects', () => {
  it('starts once and shares one in-flight runtime creation', async () => {
    let release: ((runtime: Runtime) => void) | undefined;
    const host = ports({
      createRuntime: jest.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const lifecycle = new NearbyLifecycleEffects(host);
    const first = lifecycle.start();
    const second = lifecycle.start();

    expect(first).toBe(second);
    expect(lifecycle.state()).toBe('starting');
    expect(host.createRuntime).toHaveBeenCalledTimes(1);
    release?.({ id: 'runtime-1' });
    await expect(first).resolves.toEqual({ id: 'runtime-1' });
    expect(lifecycle.state()).toBe('running');
    expect(lifecycle.current()).toEqual({ id: 'runtime-1' });
    expect(host.startRuntime).toHaveBeenCalledTimes(1);
    await expect(lifecycle.start()).resolves.toBe(lifecycle.current());
    expect(host.createRuntime).toHaveBeenCalledTimes(1);
  });

  it('invalidates a stale async start when stopped', async () => {
    let release: ((runtime: Runtime) => void) | undefined;
    const host = ports({
      createRuntime: jest.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const lifecycle = new NearbyLifecycleEffects(host);
    const starting = lifecycle.start();
    lifecycle.stop();
    release?.({ id: 'stale' });

    await expect(starting).resolves.toBeNull();
    expect(lifecycle.state()).toBe('stopped');
    expect(lifecycle.current()).toBeNull();
    expect(host.startRuntime).not.toHaveBeenCalled();
    expect(host.stopRuntime).toHaveBeenCalledWith({ id: 'stale' });
  });

  it('rejects a runtime created for an identity that changed mid-start', async () => {
    let identity = 'user-1';
    let release: ((runtime: Runtime) => void) | undefined;
    const host = ports({
      identityKey: jest.fn(() => identity),
      createRuntime: jest.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const lifecycle = new NearbyLifecycleEffects(host);
    const starting = lifecycle.start();
    identity = 'user-2';
    release?.({ id: 'user-1' });

    await expect(starting).resolves.toBeNull();
    expect(host.stopRuntime).toHaveBeenCalledWith({ id: 'user-1' });
    expect(lifecycle.current()).toBeNull();
  });

  it('stops a running runtime idempotently', async () => {
    const host = ports();
    const lifecycle = new NearbyLifecycleEffects(host);
    const runtime = await lifecycle.start();
    lifecycle.stop();
    lifecycle.stop();

    expect(host.stopRuntime).toHaveBeenCalledTimes(1);
    expect(host.stopRuntime).toHaveBeenCalledWith(runtime);
    expect(lifecycle.state()).toBe('stopped');
  });

  it('coalesces refresh bursts with one trailing refresh', async () => {
    let release: (() => void) | undefined;
    const host = ports({
      refreshRuntime: jest.fn(() => new Promise<void>((resolve) => {
        if (!release) release = resolve;
        else resolve();
      })),
    });
    const lifecycle = new NearbyLifecycleEffects(host);
    await lifecycle.start();
    const first = lifecycle.refresh();
    const second = lifecycle.refresh();
    const third = lifecycle.refresh();
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(host.refreshRuntime).toHaveBeenCalledTimes(1);

    release?.();
    await first;
    expect(host.refreshRuntime).toHaveBeenCalledTimes(2);
  });

  it('preserves one refresh requested while startup is in flight', async () => {
    let release: ((runtime: Runtime) => void) | undefined;
    const host = ports({
      createRuntime: jest.fn(() => new Promise((resolve) => { release = resolve; })),
    });
    const lifecycle = new NearbyLifecycleEffects(host);
    const starting = lifecycle.start();
    await lifecycle.refresh();
    release?.({ id: 'runtime-1' });
    await starting;
    await Promise.resolve();

    expect(host.refreshRuntime).toHaveBeenCalledTimes(1);
  });

  it('contains start and refresh failures and returns to a usable state', async () => {
    const startError = new Error('start failed');
    const failed = ports({ startRuntime: jest.fn(() => { throw startError; }) });
    const lifecycle = new NearbyLifecycleEffects(failed);
    await expect(lifecycle.start()).resolves.toBeNull();
    expect(lifecycle.state()).toBe('stopped');
    expect(failed.stopRuntime).toHaveBeenCalled();
    expect(failed.onEvent).toHaveBeenCalledWith({ type: 'start-failed', error: startError });

    const refreshError = new Error('refresh failed');
    const refreshHost = ports({
      refreshRuntime: jest.fn(async () => { throw refreshError; }),
    });
    const refreshLifecycle = new NearbyLifecycleEffects(refreshHost);
    await refreshLifecycle.start();
    await expect(refreshLifecycle.refresh()).resolves.toBeUndefined();
    expect(refreshHost.onEvent).toHaveBeenCalledWith({
      type: 'refresh-failed',
      error: refreshError,
    });
  });
});
