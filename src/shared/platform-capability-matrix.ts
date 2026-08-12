export type PlatformCapabilityInput = {
  platform: 'ios' | 'android'; osMajor: number; wifiAwareHardware: boolean; wifiDirectHardware: boolean;
  bleHardware: boolean; localNetworkPermission: boolean; nearbyWifiPermission: boolean; bluetoothPermission: boolean;
};
export type PlatformProviderCapability = { provider: 'bonjour-nsd' | 'wifi-aware' | 'wifi-direct' | 'ble'; supported: boolean; permission: 'granted' | 'denied' | 'not-required'; reason: string };

/** Pure capability/permission matrix shared by diagnostics and automated unsupported-device tests. */
export function platformCapabilityMatrix(input: PlatformCapabilityInput): PlatformProviderCapability[] {
  const ios = input.platform === 'ios';
  return [
    { provider: 'bonjour-nsd', supported: true, permission: ios ? (input.localNetworkPermission ? 'granted' : 'denied') : 'not-required', reason: ios && !input.localNetworkPermission ? 'Local Network permission denied; Internet discovery remains available.' : 'Framework DNS-SD available.' },
    { provider: 'wifi-aware', supported: input.wifiAwareHardware && (ios ? input.osMajor >= 26 : input.osMajor >= 8), permission: ios ? (input.localNetworkPermission ? 'granted' : 'denied') : (input.nearbyWifiPermission ? 'granted' : 'denied'), reason: !input.wifiAwareHardware ? 'Device has no Wi-Fi Aware capability.' : ios && input.osMajor < 26 ? 'Requires iOS 26 or later.' : 'Hardware/API available; physical verification still required.' },
    { provider: 'wifi-direct', supported: !ios && input.wifiDirectHardware, permission: !ios ? (input.nearbyWifiPermission ? 'granted' : 'denied') : 'not-required', reason: ios ? 'No cross-platform Wi-Fi Direct framework adapter on iOS.' : input.wifiDirectHardware ? 'Android framework API available.' : 'Device has no Wi-Fi Direct capability.' },
    { provider: 'ble', supported: input.bleHardware, permission: input.bluetoothPermission ? 'granted' : 'denied', reason: input.bleHardware ? 'Discovery only; upgrade before data transfer.' : 'Device has no BLE capability.' },
  ];
}
