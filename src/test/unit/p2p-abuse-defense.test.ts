import {
  BoundedNonceCache,
  P2PAbuseDefenseContext,
  P2PRateLimiter,
  SuspiciousPeerTracker,
  classifyRejectionReason,
} from '../../shared/p2p-abuse-defense';

// ---------------------------------------------------------------------------
// BoundedNonceCache
// ---------------------------------------------------------------------------

describe('BoundedNonceCache', () => {
  it('returns false for unseen nonces', () => {
    const cache = new BoundedNonceCache();
    expect(cache.has('nonce_1')).toBe(false);
  });

  it('returns true after adding a nonce', () => {
    const cache = new BoundedNonceCache();
    cache.add('nonce_1');
    expect(cache.has('nonce_1')).toBe(true);
  });

  it('duplicate nonce is a no-op', () => {
    const cache = new BoundedNonceCache(10);
    cache.add('nonce_1');
    cache.add('nonce_1');
    expect(cache.size).toBe(1);
  });

  it('evicts oldest entry when at capacity', () => {
    const cache = new BoundedNonceCache(3);
    cache.add('a');
    cache.add('b');
    cache.add('c');
    expect(cache.size).toBe(3);
    cache.add('d'); // evicts oldest ('a')
    expect(cache.size).toBe(3);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('d')).toBe(true);
  });

  it('clears all entries', () => {
    const cache = new BoundedNonceCache();
    cache.add('nonce_x');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P2PRateLimiter
// ---------------------------------------------------------------------------

describe('P2PRateLimiter', () => {
  it('allows events within limit', () => {
    const limiter = new P2PRateLimiter({ windowMs: 60_000, maxEvents: 5 });
    for (let i = 0; i < 5; i++) {
      const result = limiter.record('peer_1');
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects events over the limit', () => {
    const limiter = new P2PRateLimiter({ windowMs: 60_000, maxEvents: 3 });
    limiter.record('peer_1');
    limiter.record('peer_1');
    limiter.record('peer_1');
    const result = limiter.record('peer_1');
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/rate limit/);
      expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('resets window after window expires', () => {
    const now = Date.now();
    const limiter = new P2PRateLimiter({ windowMs: 1000, maxEvents: 2 });
    limiter.record('peer_1', now);
    limiter.record('peer_1', now);
    // Advance past window
    const result = limiter.record('peer_1', now + 1001);
    expect(result.allowed).toBe(true);
  });

  it('tracks different keys independently', () => {
    const limiter = new P2PRateLimiter({ windowMs: 60_000, maxEvents: 1 });
    expect(limiter.record('peer_a').allowed).toBe(true);
    expect(limiter.record('peer_b').allowed).toBe(true);
  });

  it('prunes stale windows', () => {
    const now = Date.now();
    const limiter = new P2PRateLimiter({ windowMs: 500, maxEvents: 10 });
    limiter.record('peer_1', now);
    limiter.record('peer_2', now);
    limiter.prune(now + 600);
    expect(limiter.trackedKeys).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// SuspiciousPeerTracker
// ---------------------------------------------------------------------------

describe('SuspiciousPeerTracker', () => {
  it('records suspicious events and increments counters', () => {
    const tracker = new SuspiciousPeerTracker(5);
    tracker.record('peer_1', 'duplicate-nonce');
    const entry = tracker.getEntry('peer_1');
    expect(entry?.counters['duplicate-nonce']).toBe(1);
    expect(entry?.totalEvents).toBe(1);
    expect(entry?.demoted).toBe(false);
  });

  it('demotes peer after threshold is reached', () => {
    const tracker = new SuspiciousPeerTracker(3);
    tracker.record('peer_1', 'malformed-payload');
    tracker.record('peer_1', 'malformed-payload');
    tracker.record('peer_1', 'malformed-payload');
    expect(tracker.isDemoted('peer_1')).toBe(true);
  });

  it('tracks multiple reasons independently', () => {
    const tracker = new SuspiciousPeerTracker(100);
    tracker.record('peer_1', 'duplicate-nonce');
    tracker.record('peer_1', 'stale-timestamp');
    const entry = tracker.getEntry('peer_1');
    expect(entry?.counters['duplicate-nonce']).toBe(1);
    expect(entry?.counters['stale-timestamp']).toBe(1);
    expect(entry?.totalEvents).toBe(2);
  });

  it('resets a peer entry', () => {
    const tracker = new SuspiciousPeerTracker(3);
    tracker.record('peer_1', 'malformed-payload');
    tracker.record('peer_1', 'malformed-payload');
    tracker.record('peer_1', 'malformed-payload');
    tracker.reset('peer_1');
    expect(tracker.getEntry('peer_1')).toBeUndefined();
    expect(tracker.isDemoted('peer_1')).toBe(false);
  });

  it('exposes diagnostics with recent rejections', () => {
    const tracker = new SuspiciousPeerTracker(5);
    tracker.record('peer_a', 'duplicate-nonce');
    tracker.record('peer_b', 'stale-timestamp');
    const diag = tracker.getDiagnostics(10);
    expect(diag.totalTrackedPeers).toBe(2);
    expect(diag.recentRejections.length).toBe(2);
  });

  it('caps the rejection log at maxLogEntries', () => {
    const tracker = new SuspiciousPeerTracker(1000, 5);
    for (let i = 0; i < 10; i++) {
      tracker.record(`peer_${i}`, 'malformed-payload');
    }
    const diag = tracker.getDiagnostics(100);
    // Log is capped at 5; getDiagnostics returns the last N
    expect(diag.recentRejections.length).toBeLessThanOrEqual(5);
  });

  it('throws when peerId is empty', () => {
    const tracker = new SuspiciousPeerTracker();
    expect(() => tracker.record('', 'malformed-payload')).toThrow(/peerId/);
  });
});

// ---------------------------------------------------------------------------
// classifyRejectionReason
// ---------------------------------------------------------------------------

describe('classifyRejectionReason', () => {
  it('maps duplicate nonce', () => {
    expect(classifyRejectionReason('duplicate nonce')).toBe('duplicate-nonce');
  });
  it('maps stale timestamp', () => {
    expect(classifyRejectionReason('stale timestamp')).toBe('stale-timestamp');
  });
  it('maps wrong peerId', () => {
    expect(classifyRejectionReason('wrong peerId')).toBe('wrong-peer-id');
  });
  it('maps invalid signature', () => {
    expect(classifyRejectionReason('invalid signature')).toBe('malformed-payload');
  });
  it('defaults to malformed-payload', () => {
    expect(classifyRejectionReason('some unknown reason')).toBe('malformed-payload');
  });
});

// ---------------------------------------------------------------------------
// P2PAbuseDefenseContext
// ---------------------------------------------------------------------------

describe('P2PAbuseDefenseContext', () => {
  it('allows well-behaved peers', () => {
    const ctx = new P2PAbuseDefenseContext({ rateLimitMaxEvents: 100 });
    const result = ctx.checkInbound('peer_1', 'pub_1');
    expect(result.allowed).toBe(true);
  });

  it('blocks demoted peers', () => {
    const ctx = new P2PAbuseDefenseContext({ demotionThreshold: 2 });
    ctx.suspiciousPeerTracker.record('peer_1', 'malformed-payload');
    ctx.suspiciousPeerTracker.record('peer_1', 'malformed-payload');
    expect(ctx.checkInbound('peer_1', 'pub_1').allowed).toBe(false);
  });

  it('blocks rate-limited peers and records suspicious event', () => {
    const ctx = new P2PAbuseDefenseContext({
      rateLimitWindowMs: 60_000,
      rateLimitMaxEvents: 2,
      demotionThreshold: 100,
    });
    ctx.checkInbound('peer_1', 'pub_1');
    ctx.checkInbound('peer_1', 'pub_1');
    const result = ctx.checkInbound('peer_1', 'pub_1');
    expect(result.allowed).toBe(false);
    const entry = ctx.suspiciousPeerTracker.getEntry('peer_1');
    expect(entry?.counters['rate-limit-exceeded']).toBeGreaterThanOrEqual(1);
  });

  it('exposes non-secret diagnostics', () => {
    const ctx = new P2PAbuseDefenseContext();
    ctx.nonceCache.add('nonce_1');
    ctx.checkInbound('peer_1', 'pub_1');
    const diag = ctx.getDiagnostics();
    expect(diag.nonceCacheSize).toBe(1);
    expect(diag.trackedRateLimitKeys).toBe(1);
    expect(typeof diag.suspiciousPeers.totalTrackedPeers).toBe('number');
  });

  it('blocked-peer attempts are tracked', () => {
    const ctx = new P2PAbuseDefenseContext({ demotionThreshold: 2 });
    ctx.suspiciousPeerTracker.record('peer_x', 'blocked-peer-attempt');
    ctx.suspiciousPeerTracker.record('peer_x', 'blocked-peer-attempt');
    const entry = ctx.suspiciousPeerTracker.getEntry('peer_x');
    expect(entry?.demoted).toBe(true);
    expect(entry?.counters['blocked-peer-attempt']).toBe(2);
  });
});
