import { applyConnectivityPreset, connectivityStatusText, defaultConnectivitySettings, loadConnectivitySettings, routePreferencesFromSettings, saveConnectivitySettings } from '../../web/ui/connectivity-settings';
import { MeshForwardingPolicy } from '../../shared/mesh-forwarding-policy';
import { ConnectionManager, pathScore, type PathInfo } from '../../shared/connection-manager';
import type { P2PMeshFrame } from '../../shared/p2p-mesh-protocol';

describe('connectivity UI settings', () => {
  beforeEach(() => localStorage.clear());
  test('supports all presets and safe forwarding defaults', () => {
    expect(defaultConnectivitySettings().forwarding).toMatchObject({ enabled: true, wifiForwarding: true, cellularForwarding: false, lowBatteryPause: true, cellularByteBudget: 0 });
    expect(applyConnectivityPreset('data-saver')).toMatchObject({ meteredPermission: 'wait-for-free' });
    expect(applyConnectivityPreset('private').forwarding.enabled).toBe(false);
    for (const preset of ['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'] as const) expect(applyConnectivityPreset(preset).preset).toBe(preset);
  });
  test('persists policy without transport identities', () => {
    const value = applyConnectivityPreset('advanced'); value.forwarding.cellularForwarding = true; value.forwarding.cellularByteBudget = 1024;
    saveConnectivitySettings(value); expect(loadConnectivitySettings()).toEqual(value);
    expect(localStorage.getItem('iinpublic_connectivity_settings_v1')).not.toMatch(/peerId|radioId|12D3/);
  });
  test('formats compact active status', () => {
    expect(connectivityStatusText({ directness: 'direct', interface: 'wifi', metered: false })).toBe('direct; wifi; free');
  });
  test('persisted forwarding setting changes live policy without exposing an ID as identity', () => {
    const settings = applyConnectivityPreset('private'); saveConnectivitySettings(settings);
    const policy = new MeshForwardingPolicy(loadConnectivitySettings().forwarding);
    const frame = { version: 1, kind: 'mesh-ping', msgId: 'm', roomId: 'r', originUserId: 'alice', originPub: 'alice-sea', recipientUserId: 'bob', createdAt: new Date().toISOString(), ttlHops: 2, payload: {} } as P2PMeshFrame;
    expect(policy.evaluate(frame, 'carol', { routeId: '12D3-transport', interface: 'wifi', lowBattery: false }, 1).allowed).toBe(false);
    expect(JSON.stringify(settings)).not.toContain('12D3-transport');
  });
  test('free, direct, battery, and metered settings each affect route policy', () => {
    const sent: string[] = [];
    const add = (manager: ConnectionManager, path: PathInfo) => manager.register({ path, send: async () => { sent.push(path.pathId); } });
    const base: PathInfo = { pathId: 'free-relay', transport: 'libp2p', interface: 'wifi', directness: 'relay', metered: false, latencyMs: 10, bandwidthKbps: 1000, batteryClass: 'low', stability: 80, health: 'healthy' };
    const meteredDirect = { ...base, pathId: 'metered-direct', directness: 'direct' as const, metered: true, interface: 'cellular' as const };
    const settings = applyConnectivityPreset('advanced'); settings.freeFirst = false; settings.directFirst = true; settings.batteryAware = false; settings.meteredPermission = 'always-allow';
    const manager = new ConnectionManager(settings.meteredPermission, undefined, routePreferencesFromSettings(settings));
    add(manager, base); add(manager, meteredDirect);
    expect(manager.select('text').selected?.pathId).toBe('metered-direct');
    settings.freeFirst = true; manager.setRoutePreferences(routePreferencesFromSettings(settings));
    expect(manager.select('text').selected?.pathId).toBe('free-relay');
    manager.setMeteredPermission('wait-for-free');
    expect(manager.select('text').selected?.metered).toBe(false);
    const highBattery = { ...base, pathId: 'high-battery', batteryClass: 'high' as const };
    expect(pathScore(base, 'text', null, { freeFirst: true, directFirst: true, batteryAware: true }))
      .toBeGreaterThan(pathScore(highBattery, 'text', null, { freeFirst: true, directFirst: true, batteryAware: true }));
    expect(pathScore(base, 'text', null, { freeFirst: true, directFirst: true, batteryAware: false }))
      .toBe(pathScore(highBattery, 'text', null, { freeFirst: true, directFirst: true, batteryAware: false }));
  });
});
