import { DEFAULT_FORWARDING_SETTINGS, type ForwardingSettings } from '../../shared/mesh-forwarding-policy';
import type { MeteredPermission } from '../../shared/connection-manager';
import type { RoutePreferences } from '../../shared/connection-manager';
import type { PathInfo } from '../../shared/connection-manager';
import type { PeerDiscoveryProviderStatus } from '../../shared/peer-discovery-provider';
import { isNearbyPublicMode, type NearbyPublicMode } from '../../shared/nearby-rooms';

export type ConnectivityPreset = 'automatic' | 'data-saver' | 'fastest' | 'local-event' | 'private' | 'advanced';
export type NearbyExchangeMode = 'off' | 'while-open' | 'always';
/**
 * Every user has one location. A Resident appears at their own blurred GPS area; a Traveler ✈
 * appears at a point they chose on the map and never shares GPS. Web/desktop has no GPS, so it is
 * always a Traveler.
 */
export type LocationSource = 'resident' | 'traveler';
export type ConnectivitySettings = {
  version: 2;
  preset: ConnectivityPreset;
  nearbyMode: NearbyExchangeMode;
  /** Area size others see (1 / 10 / 50 km; 400 m only picks the room). Exact GPS is never stored. */
  nearbyPrivacyMode: NearbyPublicMode;
  locationSource: LocationSource;
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
/**
 * Retired location choices. "Contacts only" is a Talk audience (Talk Behavior), not a location;
 * "Location off" became "Traveler". A saved retired value is migrated once on load.
 */
export type LegacyPrivacyMigration = 'contacts-only' | 'location-off' | null;
let pendingLegacyMigration: LegacyPrivacyMigration = null;

/** The retired value found on the last load, cleared once the app has applied it. */
export function takeLegacyPrivacyMigration(): LegacyPrivacyMigration {
  const value = pendingLegacyMigration;
  pendingLegacyMigration = null;
  return value;
}

export function defaultConnectivitySettings(): ConnectivitySettings {
  return { version: 2, preset: 'automatic', nearbyMode: 'while-open', nearbyPrivacyMode: 'neighborhood', locationSource: 'resident', activeRoomSelection: 'manual', wifiOnlyForwarding: true, identityReveal: 'matches-only', freeFirst: true, directFirst: true, batteryAware: true, meteredPermission: 'wait-for-free', forwarding: { ...DEFAULT_FORWARDING_SETTINGS, wifiForwarding: true } };
}

/**
 * Apply a preset to the route-policy fields it owns while preserving device-local choices such as
 * Resident/Traveler and Nearby's foreground mode. Advanced intentionally preserves every value.
 */
export function applyConnectivityPreset(
  preset: ConnectivityPreset,
  current: ConnectivitySettings = defaultConnectivitySettings(),
): ConnectivitySettings {
  const base: ConnectivitySettings = {
    ...current,
    preset,
    forwarding: { ...current.forwarding },
  };
  if (preset === 'advanced') return base;
  if (preset === 'automatic') {
    return { ...base, freeFirst: true, directFirst: true, batteryAware: true, meteredPermission: 'wait-for-free' };
  }
  if (preset === 'data-saver') {
    return {
      ...base,
      freeFirst: true,
      directFirst: true,
      batteryAware: true,
      meteredPermission: 'wait-for-free',
      wifiOnlyForwarding: true,
      forwarding: {
        ...base.forwarding,
        wifiForwarding: true,
        cellularForwarding: false,
        cellularByteBudget: 0,
      },
    };
  }
  if (preset === 'fastest') {
    return { ...base, freeFirst: false, directFirst: true, batteryAware: false };
  }
  if (preset === 'local-event') {
    return {
      ...base,
      nearbyPrivacyMode: 'close-nearby',
      freeFirst: true,
      directFirst: true,
      wifiOnlyForwarding: true,
      forwarding: { ...base.forwarding, wifiForwarding: true, cellularForwarding: false },
    };
  }
  return {
    ...base,
    nearbyPrivacyMode: 'regional',
    identityReveal: 'matches-only',
    meteredPermission: 'wait-for-free',
    wifiOnlyForwarding: true,
    forwarding: {
      ...base.forwarding,
      enabled: false,
      wifiForwarding: true,
      cellularForwarding: false,
      cellularByteBudget: 0,
    },
  };
}

export function loadConnectivitySettings(): ConnectivitySettings {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return defaultConnectivitySettings();
    const value = JSON.parse(raw) as Partial<ConnectivitySettings>;
    const valid = ['automatic', 'data-saver', 'fastest', 'local-event', 'private', 'advanced'].includes(String(value.preset));
    // `radio-nearby` used to be an audience mode; Bluetooth is now an independent provider.
    const saved = String(value.nearbyPrivacyMode);
    if (saved === 'contacts-only' || saved === 'location-off') {
      pendingLegacyMigration = saved;
      const migrated: ConnectivitySettings = {
        ...defaultConnectivitySettings(),
        ...(valid ? value : {}),
        nearbyPrivacyMode: 'neighborhood',
        locationSource: saved === 'location-off' ? 'traveler' : 'resident',
        version: 2,
      } as ConnectivitySettings;
      try { saveConnectivitySettings(migrated); } catch { /* storage blocked: migrate again next load */ }
      value.nearbyPrivacyMode = migrated.nearbyPrivacyMode;
      value.locationSource = migrated.locationSource;
    }
    const nearbyPrivacyMode: NearbyPublicMode = isNearbyPublicMode(value.nearbyPrivacyMode as never)
      ? value.nearbyPrivacyMode as NearbyPublicMode
      : 'neighborhood';
    const locationSource: LocationSource = value.locationSource === 'traveler' ? 'traveler' : 'resident';
    const wifiOnlyForwarding = value.wifiOnlyForwarding !== false;
    return valid ? { ...defaultConnectivitySettings(), ...value, nearbyPrivacyMode, locationSource, wifiOnlyForwarding, version: 2, activeRoomSelection: 'manual', forwarding: { ...defaultConnectivitySettings().forwarding, ...(value.forwarding ?? {}), wifiForwarding: wifiOnlyForwarding } } as ConnectivitySettings : defaultConnectivitySettings();
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
