/**
 * P2P-U — Fake-Client Defense + Replay/Rate Controls
 *
 * Provides:
 * - Bounded nonce replay caches for server relay routes and client receive paths
 * - Per-peer/pub/IP malformed-traffic rate limiting
 * - Suspicious-peer counters with priority downgrade (without trusting appName)
 * - Non-secret diagnostics for rejected envelopes and suspicious-peer state
 *
 * REQ-P2P-20
 */

// ---------------------------------------------------------------------------
// Bounded nonce replay cache
// ---------------------------------------------------------------------------

/**
 * A bounded nonce replay cache that evicts the oldest entries when the capacity
 * is reached.  Safe to use on server relay routes and client receive paths.
 *
 * `maxSize` defaults to 10 000 entries (enough for ~2 min of traffic at 80 req/s).
 */
export class BoundedNonceCache {
  private readonly seen = new Map<string, number>(); // nonce → insertion order
  private insertionOrder = 0;

  constructor(private readonly maxSize: number = 10_000) {}

  has(nonce: string): boolean {
    return this.seen.has(nonce);
  }

  add(nonce: string): void {
    if (this.seen.has(nonce)) return;
    if (this.seen.size >= this.maxSize) {
      // Evict the entry with the smallest insertion order (oldest)
      let oldestNonce: string | undefined;
      let oldestOrder = Infinity;
      for (const [n, order] of this.seen) {
        if (order < oldestOrder) {
          oldestOrder = order;
          oldestNonce = n;
        }
      }
      if (oldestNonce !== undefined) this.seen.delete(oldestNonce);
    }
    this.seen.set(nonce, this.insertionOrder++);
  }

  get size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
    this.insertionOrder = 0;
  }
}

// ---------------------------------------------------------------------------
// Rate limiter
// ---------------------------------------------------------------------------

export type RateLimitKey = string; // peer id, pub, or IP

export type RateLimitConfig = {
  /** Time window in milliseconds. */
  windowMs: number;
  /** Maximum allowed events per window. */
  maxEvents: number;
};

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: string; retryAfterMs: number };

interface WindowEntry {
  count: number;
  windowStart: number;
}

/**
 * Token-bucket-style rate limiter keyed by an arbitrary string (peer id, pub, IP).
 * Each key gets an independent sliding window.
 */
export class P2PRateLimiter {
  private readonly windows = new Map<RateLimitKey, WindowEntry>();

  constructor(private readonly config: RateLimitConfig) {}

  /**
   * Record an event for `key`.  Returns whether the event is within the limit.
   */
  record(key: RateLimitKey, now = Date.now()): RateLimitResult {
    const existing = this.windows.get(key);
    if (!existing || now - existing.windowStart >= this.config.windowMs) {
      // Fresh window
      this.windows.set(key, { count: 1, windowStart: now });
      return { allowed: true };
    }
    existing.count++;
    if (existing.count > this.config.maxEvents) {
      const retryAfterMs = this.config.windowMs - (now - existing.windowStart);
      return { allowed: false, reason: 'rate limit exceeded', retryAfterMs: Math.max(0, retryAfterMs) };
    }
    return { allowed: true };
  }

  /** Evict stale windows to bound memory use. */
  prune(now = Date.now()): void {
    for (const [key, entry] of this.windows) {
      if (now - entry.windowStart >= this.config.windowMs) {
        this.windows.delete(key);
      }
    }
  }

  get trackedKeys(): number {
    return this.windows.size;
  }
}

// ---------------------------------------------------------------------------
// Suspicious-peer tracking
// ---------------------------------------------------------------------------

export type SuspiciousPeerReason =
  | 'duplicate-nonce'
  | 'malformed-payload'
  | 'stale-timestamp'
  | 'wrong-peer-id'
  | 'rate-limit-exceeded'
  | 'blocked-peer-attempt';

export type SuspiciousPeerEntry = {
  peerId: string;
  /** SEA pub if known; absent for unknown/unauthenticated senders. */
  pub?: string;
  /** Counts of suspicious events per reason. */
  counters: Partial<Record<SuspiciousPeerReason, number>>;
  /** Total events across all reasons. */
  totalEvents: number;
  /** ISO-8601 timestamp of the first suspicious event. */
  firstSeenAt: string;
  /** ISO-8601 timestamp of the most recent event. */
  lastSeenAt: string;
  /**
   * True when total suspicion events exceed the demotion threshold.
   * Demoted peers are de-prioritised in the neighbor cache but not blocked.
   * Only an explicit user block sets trustLevel = 'blocked'.
   */
  demoted: boolean;
};

export type SuspiciousPeerDiagnostics = {
  totalTrackedPeers: number;
  demotedPeers: number;
  recentRejections: RejectionLogEntry[];
};

export type RejectionLogEntry = {
  peerId: string;
  reason: SuspiciousPeerReason;
  timestamp: string;
};

const DEFAULT_DEMOTION_THRESHOLD = 5;

/**
 * Tracks suspicious-peer counters and manages priority demotions.
 * Does not trust `appName` as an identity signal — only peerId and pub matter.
 */
export class SuspiciousPeerTracker {
  private readonly peers = new Map<string, SuspiciousPeerEntry>();
  private readonly rejectionLog: RejectionLogEntry[] = [];
  private readonly maxLogEntries: number;

  constructor(
    private readonly demotionThreshold = DEFAULT_DEMOTION_THRESHOLD,
    maxLogEntries = 1000,
  ) {
    this.maxLogEntries = maxLogEntries;
  }

  /**
   * Record a suspicious event for a peer.
   * Returns the updated entry so callers can decide on further action.
   */
  record(
    peerId: string,
    reason: SuspiciousPeerReason,
    opts: { pub?: string; now?: Date } = {},
  ): SuspiciousPeerEntry {
    if (!peerId) throw new Error('peerId is required to record suspicious event');
    const now = (opts.now ?? new Date()).toISOString();
    const existing = this.peers.get(peerId);
    const entry: SuspiciousPeerEntry = existing ?? {
      peerId,
      counters: {},
      totalEvents: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      demoted: false,
    };
    if (opts.pub !== undefined) entry.pub = opts.pub;
    entry.counters[reason] = (entry.counters[reason] ?? 0) + 1;
    entry.totalEvents++;
    entry.lastSeenAt = now;
    if (entry.totalEvents >= this.demotionThreshold) {
      entry.demoted = true;
    }
    this.peers.set(peerId, entry);

    // Log rejection (capped)
    if (this.rejectionLog.length >= this.maxLogEntries) {
      this.rejectionLog.shift();
    }
    this.rejectionLog.push({ peerId, reason, timestamp: now });

    return { ...entry, counters: { ...entry.counters } };
  }

  isDemoted(peerId: string): boolean {
    return this.peers.get(peerId)?.demoted ?? false;
  }

  getEntry(peerId: string): SuspiciousPeerEntry | undefined {
    const e = this.peers.get(peerId);
    if (!e) return undefined;
    return { ...e, counters: { ...e.counters } };
  }

  getDiagnostics(recentCount = 20): SuspiciousPeerDiagnostics {
    let demotedPeers = 0;
    for (const e of this.peers.values()) {
      if (e.demoted) demotedPeers++;
    }
    return {
      totalTrackedPeers: this.peers.size,
      demotedPeers,
      recentRejections: this.rejectionLog.slice(-recentCount).reverse(),
    };
  }

  reset(peerId: string): void {
    this.peers.delete(peerId);
  }
}

// ---------------------------------------------------------------------------
// Envelope rejection classifier
// ---------------------------------------------------------------------------

/**
 * Classifies a failed `verifySignedP2PEnvelopeProof` reason into a
 * `SuspiciousPeerReason` for tracking purposes.
 */
export function classifyRejectionReason(verifyReason: string): SuspiciousPeerReason {
  if (verifyReason.includes('duplicate nonce')) return 'duplicate-nonce';
  if (verifyReason.includes('stale timestamp')) return 'stale-timestamp';
  if (verifyReason.includes('wrong peerId')) return 'wrong-peer-id';
  if (verifyReason.includes('invalid signature') || verifyReason.includes('payload hash')) {
    return 'malformed-payload';
  }
  return 'malformed-payload';
}

// ---------------------------------------------------------------------------
// Combined abuse-defense context (convenience wrapper)
// ---------------------------------------------------------------------------

export type AbuseDefenseConfig = {
  nonceCacheSize?: number;
  rateLimitWindowMs?: number;
  rateLimitMaxEvents?: number;
  demotionThreshold?: number;
};

/**
 * Bundles a nonce cache, rate limiter, and suspicious-peer tracker into a
 * single context object.  Both server relay routes and client receive paths
 * can instantiate their own context.
 */
export class P2PAbuseDefenseContext {
  readonly nonceCache: BoundedNonceCache;
  readonly rateLimiter: P2PRateLimiter;
  readonly suspiciousPeerTracker: SuspiciousPeerTracker;

  constructor(config: AbuseDefenseConfig = {}) {
    this.nonceCache = new BoundedNonceCache(config.nonceCacheSize ?? 10_000);
    this.rateLimiter = new P2PRateLimiter({
      windowMs: config.rateLimitWindowMs ?? 60_000,
      maxEvents: config.rateLimitMaxEvents ?? 200,
    });
    this.suspiciousPeerTracker = new SuspiciousPeerTracker(
      config.demotionThreshold ?? DEFAULT_DEMOTION_THRESHOLD,
    );
  }

  /**
   * Process an inbound envelope:
   * 1. Rate-check the sender key.
   * 2. Record rejection + suspicious event if needed.
   * Returns `{ allowed: true }` when the envelope should proceed.
   */
  checkInbound(
    peerId: string,
    pub: string,
    opts: { now?: Date } = {},
  ): { allowed: true } | { allowed: false; reason: string } {
    if (this.suspiciousPeerTracker.isDemoted(peerId)) {
      return { allowed: false, reason: 'peer is demoted due to suspicious activity' };
    }
    const rateKey = pub || peerId;
    const rateResult = this.rateLimiter.record(rateKey, opts.now?.getTime());
    if (!rateResult.allowed) {
      const trackOpts: { pub?: string; now?: Date } = { pub };
      if (opts.now !== undefined) trackOpts.now = opts.now;
      this.suspiciousPeerTracker.record(peerId, 'rate-limit-exceeded', trackOpts);
      return { allowed: false, reason: rateResult.reason };
    }
    return { allowed: true };
  }

  getDiagnostics(): {
    nonceCacheSize: number;
    trackedRateLimitKeys: number;
    suspiciousPeers: SuspiciousPeerDiagnostics;
  } {
    return {
      nonceCacheSize: this.nonceCache.size,
      trackedRateLimitKeys: this.rateLimiter.trackedKeys,
      suspiciousPeers: this.suspiciousPeerTracker.getDiagnostics(),
    };
  }
}
