import { DEFAULT_FORWARDING_SETTINGS, type ForwardingSettings } from '../../shared/mesh-forwarding-policy';
import type { MeteredPermission } from '../../shared/connection-manager';
import type { RoutePreferences } from '../../shared/connection-manager';
import type { PathInfo } from '../../shared/connection-manager';
import type { PeerDiscoveryProviderStatus } from '../../shared/peer-discovery-provider';
import type { NearbyPrivacyMode } from '../../shared/nearby-rooms';

export type ConnectivityPreset = 'automatic' | 'data-saver' | 'fastest' | 'local-event' | 'private' | 'advanced';
export type NearbyExchangeMode = 'off' | 'while-open' | 'always';
export type ConnectivitySettings = {
  version: 2;
  preset: ConnectivityPreset;
  nearbyMode: NearbyExchangeMode;
  /** Who the automatic room may expose this device to. Exact GPS is never stored here. */
  nearbyPrivacyMode: NearbyPrivacyMode;
  activeRoomSelection: 'manual';
  wifiOnlyForwarding: boolean;
  identityReveal: 'matches-only' | 'room-presence';
  freeFirst: boolean;
  directFirst: boolean;
  batteryAware: boolean;
  meteredPermission: MeteredPermission;
  forwarding: ForwardingSettings;
};
export type ConnectivityDiagnostics = {
  providers?: readonly PeerDiscoveryProviderStatus[];
  candidateCount?: number;
  verifiedSeaBindingCount?: number;
  activePath?: PathInfo | null;
  recentFailures?: readonly { component: string; reason: string; at: string }[];
  bytesByRoute?: Readonly<Record<string, number>>;
  forwardedFrames?: number;
  droppedFrames?: number;
  abuseDrops?: number;
};
const KEY = 'iinpublic_connectivity_settings_v1';
const NEARBY_PRIVACY_MODES: readonly NearbyPrivacyMode[] = [
  'contacts-only', 'radio-nearby', 'neighborhood', 'close-nearby', 'location-off',
];

export function defaultConnectivitySettings(): ConnectivitySettings {
  return { version: 2, preset: 'automatic', nearbyMode: 'while-open', nearbyPrivacyMode: 'neighborhood', activeRoomSelection: 'manual', wifiOnlyForwarding: true, identityReveal: 'matches-only', freeFirst: true, directFirst: true, batteryAware: true, meteredPermission: 'wait-for-free', forwarding: { ...DEFAULT_FORWARDING_SETTINGS } };
}

export function applyConnectivityPreset(preset: ConnectivityPreset): ConnectivitySettings {
  const base = defaultConnectivitySettings();
  if (preset === 'data-saver') return { ...base, preset, meteredPermission: 'wait-for-free', forwarding: { ...base.forwarding, cellularForwarding: false, cellularByteBudget: 0 } };
  if (preset === 'fastest') return { ...base, preset, meteredPermission: 'ask', batteryAware: false };
  if (preset === 'local-event') return { ...base, preset, nearbyPrivacyMode: 'close-nearby' };
  if (preset === 'private') return { ...base, preset, nearbyPrivacyMode: 'contacts-only', forwarding: { ...base.forwarding, enabled: false } };
  return { ...base, preset };
}

export function loadConnectivitySettings(): ConnectivitySettings {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return defaultConnectivitySettings();
    const value = JSON.parse(raw) as Partial<ConnectivitySettings>;
    const valid = ['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'].includes(String(value.preset));
    const nearbyPrivacyMode = NEARBY_PRIVACY_MODES.includes(value.nearbyPrivacyMode as NearbyPrivacyMode)
      ? value.nearbyPrivacyMode as NearbyPrivacyMode
      : 'neighborhood';
    return valid ? { ...defaultConnectivitySettings(), ...value, nearbyPrivacyMode, version: 2, activeRoomSelection: 'manual', forwarding: { ...DEFAULT_FORWARDING_SETTINGS, ...(value.forwarding ?? {}) } } as ConnectivitySettings : defaultConnectivitySettings();
  } catch { return defaultConnectivitySettings(); }
}

export function saveConnectivitySettings(value: ConnectivitySettings): void {
  localStorage.setItem(KEY, JSON.stringify({ ...value, version: 2 }));
}

export function connectivityStatusText(input: { directness: 'direct' | 'relay' | 'store-forward'; interface: string; metered: boolean }): string {
  return `${input.directness}; ${input.interface}; ${input.metered ? 'metered' : 'free'}`;
}

/** Product-safe diagnostics: SEA bindings are counted, while transport IDs stay clearly labelled as routes. */
export function connectivityDiagnosticsText(value: ConnectivityDiagnostics): string {
  const providers = value.providers ?? [];
  const active = value.activePath
    ? `${value.activePath.directness} ${value.activePath.interface}/${value.activePath.transport} (${value.activePath.health}${value.activePath.metered ? ', metered' : ', free'})`
    : 'none';
  const failures = (value.recentFailures ?? []).slice(-10).map((failure) => `${failure.at} ${failure.component}: ${failure.reason}`);
  const routes = Object.entries(value.bytesByRoute ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([route, bytes]) => `${route}: ${bytes} bytes`);
  return [
    `Discovery providers: ${providers.length || 0}`,
    ...providers.map((provider) => `- ${provider.source} (${provider.state}); ${provider.candidateCount} candidates${provider.lastError ? `; failure: ${provider.lastError}` : ''}`),
    `Candidates: ${value.candidateCount ?? providers.reduce((sum, provider) => sum + provider.candidateCount, 0)}`,
    `Verified SEA connectivity bindings: ${value.verifiedSeaBindingCount ?? 0}`,
    `Active route (transport, not identity): ${active}`,
    `Forwarding: ${value.forwardedFrames ?? 0} frames; ${value.droppedFrames ?? 0} policy drops; ${value.abuseDrops ?? 0} abuse drops`,
    ...(routes.length ? ['Route usage:', ...routes] : []),
    ...(failures.length ? ['Recent failures:', ...failures] : ['Recent failures: none']),
  ].join('\n');
}

export function routePreferencesFromSettings(value: ConnectivitySettings): RoutePreferences {
  return { freeFirst: value.freeFirst, directFirst: value.directFirst, batteryAware: value.batteryAware };
}
