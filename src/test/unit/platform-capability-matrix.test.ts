import { platformCapabilityMatrix } from '../../shared/platform-capability-matrix';

const base = { osMajor: 26, wifiAwareHardware: true, wifiDirectHardware: true, bleHardware: true, localNetworkPermission: true, nearbyWifiPermission: true, bluetoothPermission: true };
describe('native supported/unsupported permission matrices', () => {
  test('iOS capability and denied permission degrade per provider', () => {
    const values = platformCapabilityMatrix({ ...base, platform: 'ios', localNetworkPermission: false, bluetoothPermission: false });
    expect(values).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'bonjour-nsd', supported: true, permission: 'denied' }),
      expect.objectContaining({ provider: 'wifi-aware', supported: true, permission: 'denied' }),
      expect.objectContaining({ provider: 'wifi-direct', supported: false }),
      expect.objectContaining({ provider: 'ble', permission: 'denied' }),
    ]));
  });
  test('older/unsupported Apple device makes no Wi-Fi Aware claim', () => {
    expect(platformCapabilityMatrix({ ...base, platform: 'ios', osMajor: 18, wifiAwareHardware: false }).find((value) => value.provider === 'wifi-aware')).toMatchObject({ supported: false, reason: 'Device has no Wi-Fi Aware capability.' });
  });
  test('Android permissions and absent hardware degrade independently', () => {
    const values = platformCapabilityMatrix({ ...base, platform: 'android', osMajor: 14, wifiAwareHardware: false, nearbyWifiPermission: false });
    expect(values.find((value) => value.provider === 'bonjour-nsd')).toMatchObject({ supported: true, permission: 'not-required' });
    expect(values.find((value) => value.provider === 'wifi-aware')).toMatchObject({ supported: false, permission: 'denied' });
    expect(values.find((value) => value.provider === 'wifi-direct')).toMatchObject({ supported: true, permission: 'denied' });
    expect(values.find((value) => value.provider === 'ble')).toMatchObject({ supported: true, permission: 'granted' });
  });
});
