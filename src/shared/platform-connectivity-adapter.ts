import type { ConnectivityCandidate } from './peer-discovery-provider';
import type { PathInfo } from './connection-manager';

export type PlatformCapability = 'discovery' | 'ip-path' | 'byte-stream' | 'background' | 'attachments';
export type AdapterPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';
export type AdapterState = 'stopped' | 'starting' | 'running' | 'degraded';

export type AdapterConnection = {
  path: PathInfo;
  temporaryGunPeerUrl?: string;
  send: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

export interface PlatformConnectivityAdapter {
  readonly adapterId: string;
  readonly capabilities: ReadonlySet<PlatformCapability>;
  getPermission(): AdapterPermission;
  requestPermission(): Promise<AdapterPermission>;
  start(onCandidate: (candidate: ConnectivityCandidate) => void): Promise<void>;
  stop(): Promise<void>;
  connect(candidate: ConnectivityCandidate): Promise<AdapterConnection>;
  getState(): AdapterState;
}

export class PlatformAdapterCoordinator {
  private readonly active = new Set<string>();
  constructor(private readonly adapters: readonly PlatformConnectivityAdapter[]) {}

  async start(onCandidate: (candidate: ConnectivityCandidate) => void): Promise<void> {
    await Promise.allSettled(this.adapters.map(async (adapter) => {
      let permission = adapter.getPermission();
      if (permission === 'unknown') permission = await adapter.requestPermission();
      if (permission !== 'granted') return;
      await adapter.start(onCandidate);
      this.active.add(adapter.adapterId);
    }));
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.adapters.map((adapter) => adapter.stop()));
    this.active.clear();
  }

  async connect(adapterId: string, candidate: ConnectivityCandidate): Promise<AdapterConnection> {
    const adapter = this.adapters.find((value) => value.adapterId === adapterId);
    if (!adapter) throw new Error(`unknown platform adapter: ${adapterId}`);
    if (adapter.getPermission() !== 'granted') throw new Error(`adapter permission not granted: ${adapterId}`);
    const connection = await adapter.connect(candidate);
    if (adapter.capabilities.has('ip-path') && !connection.temporaryGunPeerUrl) {
      throw new Error('IP-capable adapter must expose a temporary Gun WebSocket peer');
    }
    return boundedConnection(connection);
  }

  getActiveAdapterIds(): string[] { return [...this.active].sort(); }
}

export function boundedConnection(connection: AdapterConnection, maxFrameBytes = 1024 * 1024, maxInFlight = 16): AdapterConnection {
  let closed = false;
  let inFlight = 0;
  return {
    ...connection,
    send: async (bytes) => {
      if (closed) throw new Error('adapter connection closed');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxFrameBytes) throw new Error('malformed or oversized adapter frame');
      if (inFlight >= maxInFlight) throw new Error('adapter backpressure limit reached');
      inFlight += 1;
      try { await connection.send(bytes); } finally { inFlight -= 1; }
    },
    close: async () => { if (closed) return; closed = true; await connection.close(); },
  };
}

