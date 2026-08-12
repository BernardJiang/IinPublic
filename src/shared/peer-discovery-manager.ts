import type {
  ConnectivityCandidate,
  PeerDiscoveryProvider,
  PeerDiscoveryProviderStatus,
  PeerDiscoveryStartContext,
  Unsubscribe,
} from './peer-discovery-provider';

export const DISCOVERY_LIMITS = {
  candidates: 500,
  addressesPerCandidate: 8,
  capabilitiesPerCandidate: 32,
  roomsPerCandidate: 32,
  fieldLength: 2048,
  maxLifetimeMs: 10 * 60 * 1000,
  emittedPerProviderPerMinute: 300,
} as const;

export type DiscoveryManagerSnapshot = {
  candidates: readonly ConnectivityCandidate[];
  providers: readonly PeerDiscoveryProviderStatus[];
};

type CandidateListener = (candidate: ConnectivityCandidate) => void;

export class PeerDiscoveryManager {
  private readonly candidates = new Map<string, ConnectivityCandidate>();
  private readonly listeners = new Set<CandidateListener>();
  private readonly unsubscribes: Unsubscribe[] = [];
  private readonly rateWindows = new Map<string, number[]>();

  constructor(
    private readonly providers: readonly PeerDiscoveryProvider[],
    private readonly now: () => Date = () => new Date(),
  ) {
    const ids = providers.map((provider) => provider.providerId);
    if (new Set(ids).size !== ids.length) throw new Error('discovery provider IDs must be unique');
  }

  async start(context: PeerDiscoveryStartContext): Promise<void> {
    if (this.unsubscribes.length === 0) {
      for (const provider of this.providers) {
        this.unsubscribes.push(provider.subscribeCandidates((candidate) => this.ingest(candidate)));
      }
    }
    await Promise.allSettled(this.providers.map((provider) => provider.start(context)));
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.providers.map((provider) => provider.stop()));
    while (this.unsubscribes.length) this.unsubscribes.pop()?.();
  }

  subscribe(listener: CandidateListener): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): DiscoveryManagerSnapshot {
    this.pruneExpired();
    return {
      candidates: [...this.candidates.values()],
      providers: this.providers.map((provider) => provider.getStatus()),
    };
  }

  private ingest(raw: ConnectivityCandidate): void {
    const candidate = validateAndNormalizeCandidate(raw, this.now());
    if (!candidate || !this.withinRateLimit(candidate.sourceInstanceId)) return;
    this.pruneExpired();
    const key = candidateDedupKey(candidate);
    const existing = this.candidates.get(key);
    const merged = existing ? mergeCandidate(existing, candidate) : candidate;
    this.candidates.delete(key);
    this.candidates.set(key, merged);
    while (this.candidates.size > DISCOVERY_LIMITS.candidates) {
      const oldest = this.candidates.keys().next().value as string | undefined;
      if (!oldest) break;
      this.candidates.delete(oldest);
    }
    for (const listener of this.listeners) listener(merged);
  }

  private withinRateLimit(providerId: string): boolean {
    const nowMs = this.now().getTime();
    const cutoff = nowMs - 60_000;
    const window = (this.rateWindows.get(providerId) ?? []).filter((at) => at > cutoff);
    if (window.length >= DISCOVERY_LIMITS.emittedPerProviderPerMinute) {
      this.rateWindows.set(providerId, window);
      return false;
    }
    window.push(nowMs);
    this.rateWindows.set(providerId, window);
    return true;
  }

  private pruneExpired(): void {
    const nowMs = this.now().getTime();
    for (const [key, candidate] of this.candidates) {
      if (Date.parse(candidate.expiresAt) <= nowMs) this.candidates.delete(key);
    }
  }
}

export function validateAndNormalizeCandidate(
  raw: ConnectivityCandidate,
  now = new Date(),
): ConnectivityCandidate | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.addresses) || !Array.isArray(raw.capabilities) || !Array.isArray(raw.roomIds)) return null;
  const observedAt = Date.parse(raw.observedAt);
  const expiresAt = Date.parse(raw.expiresAt);
  if (raw.version !== 1 || !raw.candidateId?.trim() || !raw.sourceInstanceId?.trim()) return null;
  if (!Number.isFinite(observedAt) || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;
  if (expiresAt <= observedAt || expiresAt - observedAt > DISCOVERY_LIMITS.maxLifetimeMs) return null;
  const addresses = uniqueBy(raw.addresses.filter((value) => !!value && typeof value.kind === 'string' && typeof value.value === 'string'), (value) => `${value.kind}:${value.value}`)
    .filter((value) => value.value.length > 0 && value.value.length <= DISCOVERY_LIMITS.fieldLength)
    .slice(0, DISCOVERY_LIMITS.addressesPerCandidate);
  return {
    ...raw,
    candidateId: raw.candidateId.slice(0, DISCOVERY_LIMITS.fieldLength),
    addresses,
    capabilities: uniqueStrings(raw.capabilities).slice(0, DISCOVERY_LIMITS.capabilitiesPerCandidate),
    roomIds: uniqueStrings(raw.roomIds).slice(0, DISCOVERY_LIMITS.roomsPerCandidate),
  };
}

export function candidateDedupKey(candidate: ConnectivityCandidate): string {
  if (candidate.seaPub) return `sea:${candidate.seaPub}`;
  if (candidate.transportId) return `transport:${candidate.transportId}`;
  return `candidate:${candidate.sourceInstanceId}:${candidate.candidateId}`;
}

function mergeCandidate(a: ConnectivityCandidate, b: ConnectivityCandidate): ConnectivityCandidate {
  const newer = Date.parse(b.observedAt) >= Date.parse(a.observedAt) ? b : a;
  return {
    ...newer,
    addresses: uniqueBy([...a.addresses, ...b.addresses], (value) => `${value.kind}:${value.value}`)
      .slice(0, DISCOVERY_LIMITS.addressesPerCandidate),
    capabilities: uniqueStrings([...a.capabilities, ...b.capabilities])
      .slice(0, DISCOVERY_LIMITS.capabilitiesPerCandidate),
    roomIds: uniqueStrings([...a.roomIds, ...b.roomIds]).slice(0, DISCOVERY_LIMITS.roomsPerCandidate),
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    .filter((value) => value.length <= DISCOVERY_LIMITS.fieldLength);
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()];
}
