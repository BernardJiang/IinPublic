import type { AdapterConnection, AdapterPermission, AdapterState, PlatformCapability, PlatformConnectivityAdapter } from '../../shared/platform-connectivity-adapter';
import type { ConnectivityCandidate } from '../../shared/peer-discovery-provider';

export type AndroidNearbyBridge = {
  capabilities(): string;
  requestPermissions(): void;
  startNsd(port: number): void;
  startWifiAware(): void;
  connectWifiAware(transportId: string, passphrase: string): void;
  startWifiDirect(): void;
  connectWifiDirect(deviceAddress: string): void;
  startBle(seaPub: string): void;
  stop(): void;
};

type NativeCandidateDetail = { version: 1; source: 'mdns' | 'platform-nearby'; transportId: string; endpoint: string | null; capabilities: string[]; authenticated: false };

/** Web half of the open Android bridge; candidates remain unauthenticated until SEA binding verification. */
export class AndroidNearbyAdapter implements PlatformConnectivityAdapter {
  readonly adapterId = 'android-framework-nearby';
  readonly capabilities: ReadonlySet<PlatformCapability> = new Set(['discovery', 'ip-path']);
  private permission: AdapterPermission = 'unknown';
  private state: AdapterState = 'stopped';
  private candidateListener: ((candidate: ConnectivityCandidate) => void) | undefined;
  private permissionResolver: ((permission: AdapterPermission) => void) | undefined;
  private readonly candidateEvent = (event: Event): void => this.ingest((event as CustomEvent<NativeCandidateDetail>).detail);
  private readonly permissionEvent = (event: Event): void => {
    const granted = !!(event as CustomEvent<{ granted?: boolean }>).detail?.granted;
    this.permission = granted ? 'granted' : 'denied'; this.permissionResolver?.(this.permission); this.permissionResolver = undefined;
  };

  constructor(private readonly bridge: AndroidNearbyBridge, private readonly seaPub: string, private readonly now = () => new Date(), private readonly events: EventTarget = window) {}

  getPermission(): AdapterPermission { return this.permission; }
  getState(): AdapterState { return this.state; }

  requestPermission(): Promise<AdapterPermission> {
    if (this.permission !== 'unknown') return Promise.resolve(this.permission);
    return new Promise((resolve) => { this.permissionResolver = resolve; this.bridge.requestPermissions(); });
  }

  async start(onCandidate: (candidate: ConnectivityCandidate) => void): Promise<void> {
    if (this.permission !== 'granted') throw new Error('Android nearby permission not granted');
    this.state = 'starting'; this.candidateListener = onCandidate;
    this.events.addEventListener('iinpublic-nearby-candidate', this.candidateEvent);
    this.events.addEventListener('iinpublic-nearby-permission', this.permissionEvent);
    this.bridge.startNsd(8088); this.bridge.startWifiAware(); this.bridge.startWifiDirect(); this.bridge.startBle(this.seaPub);
    this.state = 'running';
  }

  async stop(): Promise<void> {
    this.bridge.stop(); this.events.removeEventListener('iinpublic-nearby-candidate', this.candidateEvent); this.events.removeEventListener('iinpublic-nearby-permission', this.permissionEvent);
    this.candidateListener = undefined; this.state = 'stopped';
  }

  async connect(candidate: ConnectivityCandidate): Promise<AdapterConnection> {
    const endpoint = candidate.addresses.find((address) => address.kind === 'local-endpoint' || address.kind === 'websocket-url')?.value;
    if (candidate.transportId?.startsWith('aware:')) this.bridge.connectWifiAware(candidate.transportId, randomPassphrase());
    if (candidate.transportId?.startsWith('wifi-direct:')) this.bridge.connectWifiDirect(candidate.transportId.slice('wifi-direct:'.length));
    if (!endpoint) throw new Error('native IP route is not ready; wait for upgraded candidate');
    const transport = candidate.capabilities.includes('wifi-aware') ? 'wifi-aware' as const : 'wifi-direct' as const;
    return {
      path: { pathId: `${this.adapterId}:${candidate.candidateId}`, transport, interface: transport === 'wifi-aware' ? 'wifi' : 'wifi-direct', directness: 'direct', metered: false, latencyMs: 50, bandwidthKbps: 10_000, batteryClass: 'medium', stability: 60, health: 'healthy' },
      temporaryGunPeerUrl: endpoint.replace(/^http/, 'ws'),
      send: async () => { throw new Error('IP platform routes synchronize through the temporary Gun peer'); },
      close: async () => undefined,
    };
  }

  observePermissionEvents(): void { this.events.addEventListener('iinpublic-nearby-permission', this.permissionEvent); }

  private ingest(detail?: NativeCandidateDetail): void {
    if (!detail || detail.version !== 1 || detail.authenticated !== false || !detail.transportId) return;
    const now = this.now();
    this.candidateListener?.({
      version: 1, candidateId: detail.transportId, source: detail.source, sourceInstanceId: this.adapterId,
      observedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 2 * 60_000).toISOString(), transportId: detail.transportId,
      addresses: detail.endpoint ? [{ kind: detail.endpoint.includes('/gun') ? 'websocket-url' : 'local-endpoint', value: detail.endpoint }] : [],
      capabilities: detail.capabilities, roomIds: [],
    });
  }
}

function randomPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}
