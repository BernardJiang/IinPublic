import {
  AbstractPeerDiscoveryProvider,
  type ConnectivityCandidate,
  type DiscoverySourceKind,
  type PeerDiscoveryStartContext,
} from '../../shared/peer-discovery-provider';
import type { PresenceRecord } from '../../shared/p2p-presence';

export type DiscoveryPoll = (
  context: PeerDiscoveryStartContext,
) => Promise<readonly ConnectivityCandidate[]>;

export type PollingProviderOptions = {
  providerId: string;
  source: DiscoverySourceKind;
  poll: DiscoveryPoll;
  intervalMs?: number;
  minBackoffMs?: number;
  maxBackoffMs?: number;
};

/** Provider-local polling/backoff; one source failure never pauses another. */
export class PollingPeerDiscoveryProvider extends AbstractPeerDiscoveryProvider {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private context: PeerDiscoveryStartContext | undefined;
  private stopped = true;
  private failures = 0;

  constructor(private readonly options: PollingProviderOptions) {
    super(options.providerId, options.source);
  }

  protected async onStart(context: PeerDiscoveryStartContext): Promise<void> {
    this.context = context;
    this.stopped = false;
    await this.pollOnce();
  }

  protected async onStop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.context = undefined;
  }

  private async pollOnce(): Promise<void> {
    if (this.stopped || !this.context) return;
    let delay = this.options.intervalMs ?? 30_000;
    try {
      const candidates = await this.options.poll(this.context);
      this.failures = 0;
      for (const candidate of candidates) this.emitCandidate(candidate);
    } catch (error) {
      this.failures += 1;
      const min = this.options.minBackoffMs ?? 1_000;
      const max = this.options.maxBackoffMs ?? 60_000;
      delay = Math.min(max, min * (2 ** Math.min(this.failures - 1, 10)));
      this.markDegraded(error instanceof Error ? error.message : String(error));
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.pollOnce(), delay);
  }
}

export function presenceRecordCandidate(
  record: PresenceRecord,
  providerId = 'hub-presence',
): ConnectivityCandidate {
  return {
    version: 1,
    candidateId: `presence:${record.pub}`,
    source: 'hub-presence',
    sourceInstanceId: providerId,
    observedAt: record.lastSeen,
    expiresAt: record.expiresAt,
    seaPub: record.pub,
    userId: record.userId,
    addresses: [],
    capabilities: record.capabilities ?? [],
    roomIds: [],
  };
}

export function transportCandidate(input: {
  providerId: string;
  source: 'known-peer' | 'libp2p-dht' | 'libp2p-bootstrap' | 'mdns' | 'discovery-gossip';
  transportId: string;
  seaPub?: string;
  multiaddrs?: readonly string[];
  roomIds?: readonly string[];
  capabilities?: readonly string[];
  now?: Date;
  ttlMs?: number;
}): ConnectivityCandidate {
  const now = input.now ?? new Date();
  return {
    version: 1,
    candidateId: `${input.source}:${input.transportId}`,
    source: input.source,
    sourceInstanceId: input.providerId,
    observedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (input.ttlMs ?? 120_000)).toISOString(),
    ...(input.seaPub ? { seaPub: input.seaPub } : {}),
    transportId: input.transportId,
    addresses: (input.multiaddrs ?? []).map((value) => ({ kind: 'multiaddr' as const, value })),
    capabilities: input.capabilities ?? [],
    roomIds: input.roomIds ?? [],
  };
}

