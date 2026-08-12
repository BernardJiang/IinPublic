/** Common lifecycle and output contract for every peer-discovery source. */

export type DiscoveryProviderState = 'stopped' | 'starting' | 'running' | 'degraded' | 'failed';

export type DiscoverySourceKind =
  | 'hub-presence'
  | 'known-peer'
  | 'libp2p-dht'
  | 'libp2p-bootstrap'
  | 'mdns'
  | 'discovery-gossip'
  | 'platform-nearby';

export type ConnectivityAddress = {
  kind: 'multiaddr' | 'websocket-url' | 'webrtc-signal' | 'local-endpoint' | 'platform-handle';
  value: string;
};

/**
 * A discovery hint, not an authenticated identity assertion. `seaPub` and
 * transport IDs become trusted only after ConnectivityBinding verification.
 */
export type ConnectivityCandidate = {
  version: 1;
  candidateId: string;
  source: DiscoverySourceKind;
  sourceInstanceId: string;
  observedAt: string;
  expiresAt: string;
  seaPub?: string;
  userId?: string;
  transportId?: string;
  addresses: readonly ConnectivityAddress[];
  capabilities: readonly string[];
  roomIds: readonly string[];
};

export type PeerDiscoveryStartContext = {
  localSeaPub: string;
  localUserId?: string;
  roomIds: readonly string[];
};

export type PeerDiscoveryProviderStatus = {
  providerId: string;
  source: DiscoverySourceKind;
  state: DiscoveryProviderState;
  candidateCount: number;
  startedAt?: string | undefined;
  lastCandidateAt?: string | undefined;
  lastError?: string | undefined;
};

export type CandidateListener = (candidate: ConnectivityCandidate) => void;
export type StatusListener = (status: PeerDiscoveryProviderStatus) => void;
export type Unsubscribe = () => void;

export interface PeerDiscoveryProvider {
  readonly providerId: string;
  readonly source: DiscoverySourceKind;
  start(context: PeerDiscoveryStartContext): Promise<void>;
  stop(): Promise<void>;
  getStatus(): PeerDiscoveryProviderStatus;
  subscribeCandidates(listener: CandidateListener): Unsubscribe;
  subscribeStatus(listener: StatusListener): Unsubscribe;
}

/**
 * Lifecycle implementation shared by concrete providers. It keeps provider
 * failures isolated: start errors become provider-local `failed` status and are
 * rethrown for the future manager to report without disabling other providers.
 */
export abstract class AbstractPeerDiscoveryProvider implements PeerDiscoveryProvider {
  private readonly candidateListeners = new Set<CandidateListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: PeerDiscoveryProviderStatus;
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<void> | undefined;

  protected constructor(
    public readonly providerId: string,
    public readonly source: DiscoverySourceKind,
  ) {
    if (!providerId.trim()) throw new Error('providerId is required');
    this.status = { providerId, source, state: 'stopped', candidateCount: 0 };
  }

  start(context: PeerDiscoveryStartContext): Promise<void> {
    if (this.status.state === 'running' || this.status.state === 'degraded') return Promise.resolve();
    if (this.startPromise) return this.startPromise;
    this.updateStatus({ state: 'starting', lastError: undefined });
    this.startPromise = this.onStart(context)
      .then(() => this.updateStatus({ state: 'running', startedAt: new Date().toISOString() }))
      .catch((error: unknown) => {
        this.updateStatus({ state: 'failed', lastError: errorMessage(error) });
        throw error;
      })
      .finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (this.status.state === 'stopped') return Promise.resolve();
    this.stopPromise = this.onStop()
      .then(() => this.updateStatus({ state: 'stopped', startedAt: undefined }))
      .catch((error: unknown) => {
        this.updateStatus({ state: 'failed', lastError: errorMessage(error) });
        throw error;
      })
      .finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }

  getStatus(): PeerDiscoveryProviderStatus {
    return { ...this.status };
  }

  subscribeCandidates(listener: CandidateListener): Unsubscribe {
    this.candidateListeners.add(listener);
    return () => this.candidateListeners.delete(listener);
  }

  subscribeStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => this.statusListeners.delete(listener);
  }

  protected emitCandidate(candidate: ConnectivityCandidate): void {
    if (candidate.source !== this.source || candidate.sourceInstanceId !== this.providerId) {
      throw new Error('candidate provenance does not match provider');
    }
    const now = new Date().toISOString();
    this.updateStatus({
      candidateCount: this.status.candidateCount + 1,
      lastCandidateAt: now,
    });
    for (const listener of this.candidateListeners) listener(candidate);
  }

  protected markDegraded(reason: string): void {
    this.updateStatus({ state: 'degraded', lastError: reason });
  }

  protected abstract onStart(context: PeerDiscoveryStartContext): Promise<void>;
  protected abstract onStop(): Promise<void>;

  private updateStatus(update: Partial<PeerDiscoveryProviderStatus>): void {
    this.status = { ...this.status, ...update };
    for (const listener of this.statusListeners) listener(this.getStatus());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
