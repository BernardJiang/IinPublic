import { DEFAULT_FORWARDING_SETTINGS, type ForwardingSettings } from '../../shared/mesh-forwarding-policy';
import type { MeteredPermission } from '../../shared/connection-manager';
import type { RoutePreferences } from '../../shared/connection-manager';
import type { PathInfo } from '../../shared/connection-manager';
import type { PeerDiscoveryProviderStatus } from '../../shared/peer-discovery-provider';

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
