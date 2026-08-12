import { applyConnectivityPreset, connectivityStatusText, defaultConnectivitySettings, loadConnectivitySettings, saveConnectivitySettings } from '../../web/ui/connectivity-settings';

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
});

