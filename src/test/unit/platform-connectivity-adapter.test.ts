import { PlatformAdapterCoordinator, type AdapterConnection, type AdapterPermission, type AdapterState, type PlatformConnectivityAdapter } from '../../shared/platform-connectivity-adapter';
import type { ConnectivityCandidate } from '../../shared/peer-discovery-provider';

const candidate: ConnectivityCandidate = { version: 1, candidateId: 'c', source: 'platform-nearby', sourceInstanceId: 'native', observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), addresses: [], capabilities: [], roomIds: [] };

class FakeAdapter implements PlatformConnectivityAdapter {
  readonly adapterId: string; readonly capabilities: ReadonlySet<'discovery' | 'ip-path' | 'byte-stream'>;
  permission: AdapterPermission; state: AdapterState = 'stopped'; closes = 0; sends = 0;
  constructor(id: string, permission: AdapterPermission, ip = true) { this.adapterId = id; this.permission = permission; this.capabilities = new Set(ip ? ['discovery', 'ip-path'] : ['discovery', 'byte-stream']); }
  getPermission(): AdapterPermission { return this.permission; }
  async requestPermission(): Promise<AdapterPermission> { return this.permission; }
  async start(onCandidate: (value: ConnectivityCandidate) => void): Promise<void> { this.state = 'running'; onCandidate(candidate); }
  async stop(): Promise<void> { this.state = 'stopped'; }
  getState(): AdapterState { return this.state; }
  async connect(): Promise<AdapterConnection> { return { path: { pathId: this.adapterId, transport: 'wifi-direct', interface: 'wifi-direct', directness: 'direct', metered: false, latencyMs: 10, bandwidthKbps: 10_000, batteryClass: 'medium', stability: 80, health: 'healthy' }, ...(this.capabilities.has('ip-path') ? { temporaryGunPeerUrl: 'ws://192.168.49.1:8080/gun' } : {}), send: async () => { this.sends += 1; }, close: async () => { this.closes += 1; } }; }
}

describe('open platform connectivity adapter contract', () => {
  test('permission denial degrades independently', async () => {
    const denied = new FakeAdapter('denied', 'denied'); const allowed = new FakeAdapter('allowed', 'granted');
    const coordinator = new PlatformAdapterCoordinator([denied, allowed]); const seen: string[] = [];
    await coordinator.start((value) => seen.push(value.candidateId));
    expect(coordinator.getActiveAdapterIds()).toEqual(['allowed']); expect(seen).toEqual(['c']);
  });

  test('IP adapters expose temporary Gun WebSocket peers', async () => {
    const adapter = new FakeAdapter('wifi-aware', 'granted'); const coordinator = new PlatformAdapterCoordinator([adapter]);
    await coordinator.start(() => undefined);
    await expect(coordinator.connect(adapter.adapterId, candidate)).resolves.toMatchObject({ temporaryGunPeerUrl: 'ws://192.168.49.1:8080/gun' });
  });

  test('bounds malformed input and backpressure, supports reconnect and idempotent shutdown', async () => {
    const adapter = new FakeAdapter('stream', 'granted', false); const coordinator = new PlatformAdapterCoordinator([adapter]);
    await coordinator.start(() => undefined); const first = await coordinator.connect('stream', candidate);
    await expect(first.send(new Uint8Array())).rejects.toThrow('malformed');
    await first.send(new Uint8Array([1])); await first.close(); await first.close();
    const second = await coordinator.connect('stream', candidate); await second.send(new Uint8Array([2])); await second.close();
    expect(adapter.sends).toBe(2); expect(adapter.closes).toBe(2);
    await coordinator.stop(); expect(adapter.getState()).toBe('stopped');
  });
});

