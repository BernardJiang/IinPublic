import { AndroidNearbyAdapter, type AndroidNearbyBridge } from '../../web/services/android-nearby-adapter';

class FakeBridge implements AndroidNearbyBridge {
  calls: string[] = [];
  capabilities(): string { return JSON.stringify({ vendorIndependent: true, googleNearbyRequired: false, ipfsOverBle: false }); }
  requestPermissions(): void { this.calls.push('permission'); }
  startNsd(): void { this.calls.push('nsd'); }
  startWifiAware(): void { this.calls.push('aware'); }
  connectWifiAware(): void { this.calls.push('connect-aware'); }
  startWifiDirect(): void { this.calls.push('direct'); }
  connectWifiDirect(): void { this.calls.push('connect-direct'); }
  startBle(): void { this.calls.push('ble'); }
  stop(): void { this.calls.push('stop'); }
}

describe('Android framework nearby adapter', () => {
  test('permission denial is explicit and does not start providers', async () => {
    const bridge = new FakeBridge(); const events = new EventTarget(); const adapter = new AndroidNearbyAdapter(bridge, 'sea-alice', undefined, events); adapter.observePermissionEvents();
    const pending = adapter.requestPermission(); events.dispatchEvent(permissionEvent(false));
    await expect(pending).resolves.toBe('denied'); await expect(adapter.start(() => undefined)).rejects.toThrow('permission');
    expect(bridge.calls).toEqual(['permission']);
  });

  test('starts vendor-independent sources and emits unauthenticated upgrade candidates', async () => {
    const bridge = new FakeBridge(); const events = new EventTarget(); const adapter = new AndroidNearbyAdapter(bridge, 'sea-alice', () => new Date('2026-08-12T00:00:00Z'), events); adapter.observePermissionEvents();
    const permission = adapter.requestPermission(); events.dispatchEvent(permissionEvent(true)); await permission;
    const candidates: any[] = []; await adapter.start((candidate) => candidates.push(candidate));
    events.dispatchEvent(detailEvent('iinpublic-nearby-candidate', { version: 1, source: 'platform-nearby', transportId: 'aware:7', endpoint: null, capabilities: ['wifi-aware', 'ip-upgrade'], authenticated: false }));
    expect(bridge.calls).toEqual(['permission', 'nsd', 'aware', 'direct', 'ble']);
    expect(candidates[0]).toMatchObject({ candidateId: 'aware:7', source: 'platform-nearby', addresses: [] });
    expect(candidates[0]).not.toHaveProperty('seaPub');
    await expect(adapter.connect(candidates[0])).rejects.toThrow('not ready'); expect(bridge.calls).toContain('connect-aware');
    await adapter.stop(); expect(adapter.getState()).toBe('stopped');
  });

  test('upgraded IP candidate exposes temporary Gun peer and never sends bytes over BLE', async () => {
    const bridge = new FakeBridge(); const events = new EventTarget(); const adapter = new AndroidNearbyAdapter(bridge, 'sea-alice', undefined, events); adapter.observePermissionEvents();
    const permission = adapter.requestPermission(); events.dispatchEvent(permissionEvent(true)); await permission; await adapter.start(() => undefined);
    const connection = await adapter.connect({ version: 1, candidateId: 'direct-1', source: 'platform-nearby', sourceInstanceId: 'native', observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000).toISOString(), transportId: 'wifi-direct:aa:bb', addresses: [{ kind: 'websocket-url', value: 'http://192.168.49.1:8088/gun' }], capabilities: ['wifi-direct', 'ip'], roomIds: [] });
    expect(connection.temporaryGunPeerUrl).toBe('ws://192.168.49.1:8088/gun'); await expect(connection.send(new Uint8Array([1]))).rejects.toThrow('temporary Gun peer');
  });
});

function detailEvent(name: string, detail: unknown): Event { const event = new Event(name) as CustomEvent; Object.defineProperty(event, 'detail', { value: detail }); return event; }
function permissionEvent(granted: boolean): Event { return detailEvent('iinpublic-nearby-permission', { granted }); }
