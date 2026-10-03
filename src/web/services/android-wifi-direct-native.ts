import type { WifiDirectGroupCredentials } from '../../shared/wifi-direct-link';
import type { LocalLinkRelay, WifiDirectNative, WifiDirectNativeCapabilities, WifiDirectNativeState } from './wifi-direct-link-service';

/** Wi-Fi Direct group methods on `window.IinPublicNearby` (NearbyJavascriptBridge.kt). */
export type AndroidWifiDirectBridge = {
  capabilities(): string;
  requestWifiDirectPermission(): void;
  createWifiDirectGroup(networkName: string, passphrase: string): void;
  joinWifiDirectGroup(networkName: string, passphrase: string, ownerDeviceAddress: string, frequencyMhz: number): void;
  leaveWifiDirectGroup(): void;
  wifiDirectState(): string;
};

export const WIFI_DIRECT_LINK_FLAG_KEY = 'iinpublic_wifi_direct_link';

/**
 * OPEN-36 feature flag, off by default. `?wifi_direct_link=1|0` (MainActivity forwards the
 * `--ez wifi_direct_link` adb extra) persists the choice; otherwise the stored value applies.
 */
export function resolveWifiDirectLinkFlag(search: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  const fromQuery = new URLSearchParams(search).get('wifi_direct_link');
  try {
    if (fromQuery === '1' || fromQuery === '0') storage?.setItem(WIFI_DIRECT_LINK_FLAG_KEY, fromQuery);
    return (fromQuery ?? storage?.getItem(WIFI_DIRECT_LINK_FLAG_KEY)) === '1';
  } catch {
    return fromQuery === '1';
  }
}

const STATES = new Set<WifiDirectNativeState['state']>(['idle', 'forming', 'joining', 'owner', 'client', 'failed']);

export function parseNativeWifiDirectState(value: unknown): WifiDirectNativeState {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const state = STATES.has(record.state as WifiDirectNativeState['state']) ? (record.state as WifiDirectNativeState['state']) : 'idle';
  const text = (key: string): string | undefined => (typeof record[key] === 'string' && record[key] ? String(record[key]) : undefined);
  const result: WifiDirectNativeState = { state };
  for (const key of ['networkName', 'passphrase', 'ownerDeviceAddress', 'ownerIp', 'localIp', 'reason'] as const) {
    const v = text(key);
    if (v) result[key] = v;
  }
  if (typeof record.clientCount === 'number') result.clientCount = record.clientCount;
  if (typeof record.frequencyMhz === 'number' && record.frequencyMhz > 0) result.frequencyMhz = record.frequencyMhz;
  return result;
}

/** Returns the bridge when the Android shell exposes the Wi-Fi Direct group API, else null. */
export function readAndroidWifiDirectBridge(win: unknown = typeof window !== 'undefined' ? window : undefined): AndroidWifiDirectBridge | null {
  const bridge = (win as { IinPublicNearby?: Partial<AndroidWifiDirectBridge> } | undefined)?.IinPublicNearby;
  if (!bridge || typeof bridge.createWifiDirectGroup !== 'function' || typeof bridge.wifiDirectState !== 'function') return null;
  return bridge as AndroidWifiDirectBridge;
}

export class AndroidWifiDirectNative implements WifiDirectNative {
  private state: WifiDirectNativeState;
  private readonly listeners = new Set<(state: WifiDirectNativeState) => void>();
  private permissionWaiters: Array<(granted: boolean) => void> = [];
  private readonly stateEvent = (event: Event): void => {
    this.state = parseNativeWifiDirectState((event as CustomEvent).detail);
    for (const listener of [...this.listeners]) listener(this.state);
  };
  private readonly permissionEvent = (event: Event): void => {
    const granted = !!(event as CustomEvent<{ granted?: boolean }>).detail?.granted;
    const waiters = this.permissionWaiters;
    this.permissionWaiters = [];
    for (const resolve of waiters) resolve(granted);
  };

  constructor(private readonly bridge: AndroidWifiDirectBridge, private readonly events: EventTarget = window) {
    this.state = this.readState();
    events.addEventListener('iinpublic-nearby-wifi-direct', this.stateEvent);
    events.addEventListener('iinpublic-nearby-permission', this.permissionEvent);
  }

  capabilities(): WifiDirectNativeCapabilities {
    try {
      const caps = JSON.parse(this.bridge.capabilities()) as Record<string, unknown>;
      return {
        wifiDirect: caps.wifiDirect === true,
        joinByCredential: caps.wifiDirectJoinByCredential === true,
        hostScore: typeof caps.hostScore === 'number' ? caps.hostScore : 0,
      };
    } catch {
      return { wifiDirect: false, joinByCredential: false, hostScore: 0 };
    }
  }

  requestPermission(): Promise<boolean> {
    return new Promise((resolve) => {
      this.permissionWaiters.push(resolve);
      this.bridge.requestWifiDirectPermission();
    });
  }

  createGroup(credentials: WifiDirectGroupCredentials): void {
    this.bridge.createWifiDirectGroup(credentials.networkName, credentials.passphrase);
  }

  joinGroup(credentials: WifiDirectGroupCredentials): void {
    this.bridge.joinWifiDirectGroup(credentials.networkName, credentials.passphrase, credentials.ownerDeviceAddress ?? '', credentials.frequencyMhz ?? 0);
  }

  leaveGroup(): void {
    this.bridge.leaveWifiDirectGroup();
  }

  getState(): WifiDirectNativeState {
    return this.state;
  }

  onState(listener: (state: WifiDirectNativeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.events.removeEventListener('iinpublic-nearby-wifi-direct', this.stateEvent);
    this.events.removeEventListener('iinpublic-nearby-permission', this.permissionEvent);
    this.listeners.clear();
  }

  private readState(): WifiDirectNativeState {
    try {
      return parseNativeWifiDirectState(JSON.parse(this.bridge.wifiDirectState()));
    } catch {
      return { state: 'idle' };
    }
  }
}

/** The embedded node's loopback TURN relay for the group link (`src/server/routes/local-link-routes.ts`). */
export class EmbeddedNodeLocalRelay implements LocalLinkRelay {
  constructor(private readonly apiBase: string) {}

  async start(groupAddress: string): Promise<RTCIceServer> {
    const res = await fetch(`${this.apiBase}/api/local-link/relay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ relayAddress: groupAddress }),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`local relay start failed: ${res.status}`);
    const body = (await res.json()) as { urls?: unknown; username?: unknown; credential?: unknown };
    if (!Array.isArray(body.urls) || typeof body.username !== 'string' || typeof body.credential !== 'string') {
      throw new Error('local relay returned no credentials');
    }
    return { urls: body.urls.filter((url): url is string => typeof url === 'string'), username: body.username, credential: body.credential };
  }

  async stop(): Promise<void> {
    await fetch(`${this.apiBase}/api/local-link/relay`, { method: 'DELETE', cache: 'no-store' });
  }
}
