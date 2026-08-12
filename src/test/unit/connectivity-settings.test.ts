import { applyConnectivityPreset, connectivityStatusText, defaultConnectivitySettings, loadConnectivitySettings, saveConnectivitySettings } from '../../web/ui/connectivity-settings';
import { MeshForwardingPolicy } from '../../shared/mesh-forwarding-policy';
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
});
