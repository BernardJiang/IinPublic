import { DEFAULT_FORWARDING_SETTINGS, type ForwardingSettings } from '../../shared/mesh-forwarding-policy';
import type { MeteredPermission } from '../../shared/connection-manager';

export type ConnectivityPreset = 'automatic' | 'data-saver' | 'fastest' | 'local-event' | 'private' | 'advanced';
export type ConnectivitySettings = {
  version: 1;
  preset: ConnectivityPreset;
  freeFirst: boolean;
  directFirst: boolean;
  batteryAware: boolean;
  meteredPermission: MeteredPermission;
  forwarding: ForwardingSettings;
};
const KEY = 'iinpublic_connectivity_settings_v1';

export function defaultConnectivitySettings(): ConnectivitySettings {
  return { version: 1, preset: 'automatic', freeFirst: true, directFirst: true, batteryAware: true, meteredPermission: 'ask', forwarding: { ...DEFAULT_FORWARDING_SETTINGS } };
}

export function applyConnectivityPreset(preset: ConnectivityPreset): ConnectivitySettings {
  const base = defaultConnectivitySettings();
  if (preset === 'data-saver') return { ...base, preset, meteredPermission: 'wait-for-free', forwarding: { ...base.forwarding, cellularForwarding: false, cellularByteBudget: 0 } };
  if (preset === 'fastest') return { ...base, preset, meteredPermission: 'ask', batteryAware: false };
  if (preset === 'local-event') return { ...base, preset, forwarding: { ...base.forwarding, enabled: true, wifiForwarding: true } };
  if (preset === 'private') return { ...base, preset, forwarding: { ...base.forwarding, enabled: false } };
  return { ...base, preset };
}

export function loadConnectivitySettings(): ConnectivitySettings {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return defaultConnectivitySettings();
    const value = JSON.parse(raw) as Partial<ConnectivitySettings>;
    const valid = ['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'].includes(String(value.preset));
    return valid ? { ...defaultConnectivitySettings(), ...value, version: 1, forwarding: { ...DEFAULT_FORWARDING_SETTINGS, ...(value.forwarding ?? {}) } } as ConnectivitySettings : defaultConnectivitySettings();
  } catch { return defaultConnectivitySettings(); }
}

export function saveConnectivitySettings(value: ConnectivitySettings): void {
  localStorage.setItem(KEY, JSON.stringify({ ...value, version: 1 }));
}

export function connectivityStatusText(input: { directness: 'direct' | 'relay' | 'store-forward'; interface: string; metered: boolean }): string {
  return `${input.directness}; ${input.interface}; ${input.metered ? 'metered' : 'free'}`;
}

