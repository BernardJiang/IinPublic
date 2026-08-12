import { ConnectionManager, type ConnectionAdapter, type OperationClass, type PathInfo } from '../../shared/connection-manager';

function path(overrides: Partial<PathInfo> & Pick<PathInfo, 'pathId'>): PathInfo {
  return { transport: 'libp2p', interface: 'wifi', directness: 'direct', metered: false,
    latencyMs: 20, bandwidthKbps: 20_000, batteryClass: 'low', stability: 90, health: 'healthy', ...overrides };
}
function adapter(value: PathInfo, sent: string[], fail = false): ConnectionAdapter {
  return { path: value, send: async (id) => { sent.push(`${value.pathId}:${id}`); if (fail) throw new Error('failed'); } };
}

describe('ConnectionManager route policy', () => {
  test.each([
    ['text', path({ pathId: 'free-relay', directness: 'relay' }), path({ pathId: 'cell-direct', interface: 'cellular', metered: true }), 'free-relay'],
    ['text', path({ pathId: 'stable', stability: 95, latencyMs: 50 }), path({ pathId: 'fast-unstable', stability: 20, latencyMs: 5 }), 'stable'],
    ['ipfs-bulk', path({ pathId: 'ble', transport: 'ble', interface: 'bluetooth' }), path({ pathId: 'wifi' }), 'wifi'],
  ] as Array<[OperationClass, PathInfo, PathInfo, string]>)('selects deterministic route for %s', (operation, a, b, expected) => {
    const manager = new ConnectionManager('always-allow');
    manager.register(adapter(a, [])); manager.register(adapter(b, []));
    expect(manager.select(operation).selected?.pathId).toBe(expected);
  });

  test('does not use a newly metered route without permission', async () => {
    const sent: string[] = [];
    const manager = new ConnectionManager('ask');
    manager.register(adapter(path({ pathId: 'cell', interface: 'cellular', metered: true }), sent));
    expect(manager.select('text')).toMatchObject({ selected: null, permissionRequired: true });
    await expect(manager.send('text', 'msg-1', new Uint8Array())).rejects.toThrow('permission');
    expect(sent).toEqual([]);
  });

  test('allow-once is consumed after one metered send', async () => {
    const sent: string[] = [];
    const manager = new ConnectionManager('ask', async () => 'allow-once');
    manager.register(adapter(path({ pathId: 'cell', interface: 'cellular', metered: true }), sent));
    await manager.send('urgent-action', 'msg-1', new Uint8Array());
    expect(manager.select('text').selected).toBeNull();
  });

  test('route migration preserves object ID and produces one successful delivery', async () => {
    const attempts: string[] = [];
    const manager = new ConnectionManager('always-allow');
    manager.register(adapter(path({ pathId: 'preferred' }), attempts, true));
    manager.register(adapter(path({ pathId: 'fallback', directness: 'relay' }), attempts));
    const result = await manager.send('text', 'gun-soul-123', new Uint8Array([1]));
    expect(result.selected?.pathId).toBe('fallback');
    expect(attempts).toEqual(['preferred:gun-soul-123', 'fallback:gun-soul-123']);
    expect(new Set(attempts.map((value) => value.split(':')[1]))).toEqual(new Set(['gun-soul-123']));
  });

  test('explains selection and lists alternatives', () => {
    const manager = new ConnectionManager();
    manager.register(adapter(path({ pathId: 'wifi' }), []));
    manager.register(adapter(path({ pathId: 'relay', directness: 'relay' }), []));
    const selection = manager.select('background-sync');
    expect(selection.reason).toContain('free route');
    expect(selection.alternatives.map((item) => item.pathId)).toEqual(['relay']);
  });
});

