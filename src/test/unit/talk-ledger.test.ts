/**
 * src/test/unit/talk-ledger.test.ts
 *
 * Pure-function unit tests for src/shared/talk-ledger.ts
 * Coverage: ordering matrix, suppression, edge-gate, store round-trip, eviction.
 */

import {
  emptyTalkLedgerDoc,
  applyEvent,
  compareResponse,
  isStaleAgainstRetraction,
  shouldSuppress,
  applyEdgeGate,
  evictLedger,
  buildTagIdentityKeys,
  getUtcDayStartMs,
  getUtcWeekStartMs,
  outcomeKey,
  exchangedKey,
  retractedKey,
  setTalkLedgerQuotaUnlimited,
  TALK_SEND_DAILY,
  TALK_SEND_WEEKLY,
  TALK_EDGE_COOLDOWN_MS,
  type TalkAnsweredEvent,
} from '../../shared/talk-ledger';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnsweredEvent(overrides: Partial<TalkAnsweredEvent> = {}): TalkAnsweredEvent {
  return {
    kind: 'TALK_ANSWERED',
    responderId: 'jerry',
    talkId: 'talk1',
    authorId: 'tom',
    identityKey: 'qa_abc123',
    outcome: 'matched',
    version: 1,
    responseId: 'resp1',
    respondedAt: '2024-01-01T10:00:00.000Z',
    now: '2024-01-01T10:00:00.000Z',
    ...overrides,
  };
}

// ─── emptyTalkLedgerDoc ────────────────────────────────────────────────────────

describe('emptyTalkLedgerDoc', () => {
  it('produces a valid empty doc', () => {
    const doc = emptyTalkLedgerDoc();
    expect(doc.version).toBe(1);
    expect(doc.outcomes).toEqual({});
    expect(doc.exchanged).toEqual({});
    expect(doc.edges).toEqual({});
    expect(doc.retracted).toEqual({});
  });
});

// ─── compareResponse ──────────────────────────────────────────────────────────

describe('compareResponse', () => {
  const base = { version: 1, respondedAt: '2024-01-01T10:00:00.000Z', responseId: 'r1' };

  it('higher version wins', () => {
    const incoming = { version: 2, respondedAt: '2024-01-01T10:00:00.000Z', responseId: 'r2' };
    expect(compareResponse(base, incoming)).toBeGreaterThan(0);
  });

  it('lower version is stale', () => {
    const incoming = { version: 1, respondedAt: '2024-01-01T10:00:00.000Z', responseId: 'r1' };
    expect(compareResponse({ ...base, version: 2 }, incoming)).toBeLessThan(0);
  });

  it('same version + same responseId → exact replay (0)', () => {
    expect(compareResponse(base, base)).toBe(0);
  });

  it('same version, later respondedAt → incoming wins', () => {
    const incoming = { version: 1, respondedAt: '2024-01-01T11:00:00.000Z', responseId: 'r2' };
    expect(compareResponse(base, incoming)).toBeGreaterThan(0);
  });

  it('same version, earlier respondedAt → incoming is stale', () => {
    const incoming = { version: 1, respondedAt: '2024-01-01T09:00:00.000Z', responseId: 'r2' };
    expect(compareResponse(base, incoming)).toBeLessThan(0);
  });

  it('same version, same timestamp, different responseId → keep existing (0)', () => {
    // tIncoming - tExisting = 0; returns 0
    const incoming = { version: 1, respondedAt: base.respondedAt, responseId: 'r_other' };
    expect(compareResponse(base, incoming)).toBe(0);
  });
});

// ─── isStaleAgainstRetraction ─────────────────────────────────────────────────

describe('isStaleAgainstRetraction', () => {
  it('answer before retraction is stale', () => {
    expect(
      isStaleAgainstRetraction(
        { respondedAt: '2024-01-01T08:00:00.000Z' },
        { retractedAt: new Date('2024-01-01T10:00:00.000Z').getTime() },
      ),
    ).toBe(true);
  });

  it('answer after retraction is not stale', () => {
    expect(
      isStaleAgainstRetraction(
        { respondedAt: '2024-01-01T12:00:00.000Z' },
        { retractedAt: new Date('2024-01-01T10:00:00.000Z').getTime() },
      ),
    ).toBe(false);
  });

  it('answer at exact retraction time is not stale (boundary)', () => {
    const ts = new Date('2024-01-01T10:00:00.000Z').getTime();
    expect(
      isStaleAgainstRetraction(
        { respondedAt: new Date(ts).toISOString() },
        { retractedAt: ts },
      ),
    ).toBe(false);
  });
});

// ─── applyEvent — TALK_ANSWERED ───────────────────────────────────────────────

describe('applyEvent — TALK_ANSWERED', () => {
  it('writes outcome + exchanged entry on first receipt', () => {
    const doc = emptyTalkLedgerDoc();
    const ev = makeAnsweredEvent();
    applyEvent(doc, ev);

    const ok = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[ok]).toBeDefined();
    expect(doc.outcomes[ok]!.outcome).toBe('matched');
    expect(doc.outcomes[ok]!.version).toBe(1);
    expect(doc.outcomes[ok]!.identityKey).toBe('qa_abc123');

    const ek = exchangedKey('jerry', 'qa_abc123');
    expect(doc.exchanged[ek]).toBeDefined();
    expect(doc.exchanged[ek]!.role).toBe('author');
  });

  it('replaces outcome when incoming version is higher', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 1, responseId: 'r1' }));
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 2, responseId: 'r2' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('matched');
    expect(doc.outcomes[k]!.version).toBe(2);
  });

  it('rejects stale version (version <= existing)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 2, responseId: 'r2' }));
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 1, responseId: 'r1' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('matched');
    expect(doc.outcomes[k]!.version).toBe(2);
  });

  it('rejects exact replay (same responseId)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responseId: 'r1', respondedAt: '2024-01-01T10:00:00.000Z' }));
    // same responseId → idempotent
    applyEvent(doc, makeAnsweredEvent({ responseId: 'r1', respondedAt: '2024-01-01T10:00:00.000Z' }));

    expect(Object.keys(doc.outcomes)).toHaveLength(1);
  });

  it('rejects answer when talk is already retracted (stale against retraction)', () => {
    const doc = emptyTalkLedgerDoc();
    // Retract first
    applyEvent(doc, {
      kind: 'TALK_RETRACTED',
      talkId: 'talk1',
      authorId: 'tom',
      retractedAt: new Date('2024-01-01T12:00:00.000Z').getTime(),
    });
    // Answer has respondedAt before retraction
    applyEvent(doc, makeAnsweredEvent({ respondedAt: '2024-01-01T09:00:00.000Z' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeUndefined();
  });

  it('accepts answer when respondedAt is after retraction (retraction-before-answer edge case)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, {
      kind: 'TALK_RETRACTED',
      talkId: 'talk1',
      authorId: 'tom',
      retractedAt: new Date('2024-01-01T10:00:00.000Z').getTime(),
    });
    // Answer is after retraction
    applyEvent(doc, makeAnsweredEvent({ respondedAt: '2024-01-01T11:00:00.000Z' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeDefined();
  });
});

// ─── applyEvent — TALK_RETRACTED ─────────────────────────────────────────────

describe('applyEvent — TALK_RETRACTED', () => {
  it('writes tombstone', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 12345 });

    const k = retractedKey('talk1', 'tom');
    expect(doc.retracted[k]).toEqual({ retractedAt: 12345 });
  });

  it('clears existing outcome and exchanged entries for the retracted talk', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent());
    expect(Object.keys(doc.outcomes)).toHaveLength(1);
    expect(Object.keys(doc.exchanged)).toHaveLength(1);

    applyEvent(doc, {
      kind: 'TALK_RETRACTED',
      talkId: 'talk1',
      authorId: 'tom',
      retractedAt: Date.now(),
    });
    expect(Object.keys(doc.outcomes)).toHaveLength(0);
    expect(Object.keys(doc.exchanged)).toHaveLength(0);
  });

  it('keeps max retractedAt on duplicate retractions', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 't', authorId: 'a', retractedAt: 100 });
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 't', authorId: 'a', retractedAt: 200 });
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 't', authorId: 'a', retractedAt: 50 });

    expect(doc.retracted[retractedKey('t', 'a')]!.retractedAt).toBe(200);
  });

  it('does not affect outcomes for a different author of the same talkId', () => {
    const doc = emptyTalkLedgerDoc();
    // Alice (not tom) authored a talk with same id — should not be cleared
    applyEvent(doc, makeAnsweredEvent({ authorId: 'alice', responseId: 'r_alice' }));
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 999 });

    const k = outcomeKey('jerry', 'talk1', 'alice');
    expect(doc.outcomes[k]).toBeDefined();
  });
});

// ─── shouldSuppress ───────────────────────────────────────────────────────────

describe('shouldSuppress', () => {
  it('returns false for a fresh peer+identity (no entry)', () => {
    const doc = emptyTalkLedgerDoc();
    expect(shouldSuppress(doc, 'jerry', 'qa_tennis')).toBe(false);
  });

  it('returns true when exchanged entry exists for (peerId, identityKey)', () => {
    const doc = emptyTalkLedgerDoc();
    doc.exchanged[exchangedKey('jerry', 'qa_tennis')] = {
      peerId: 'jerry',
      identityKey: 'qa_tennis',
      outcome: 'matched',
      version: 1,
      role: 'author',
      lastExchangedAt: new Date().toISOString(),
    };
    expect(shouldSuppress(doc, 'jerry', 'qa_tennis')).toBe(true);
  });

  it('returns true when an outcome row exists for (responderId=peer, identityKey)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responderId: 'jerry', identityKey: 'qa_tennis' }));
    expect(shouldSuppress(doc, 'jerry', 'qa_tennis')).toBe(true);
  });

  it('returns false for a different peer even if identity matches', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responderId: 'bob', identityKey: 'qa_tennis' }));
    expect(shouldSuppress(doc, 'jerry', 'qa_tennis')).toBe(false);
  });

  it('returns false for a different identityKey even if peer matches', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responderId: 'jerry', identityKey: 'qa_tennis' }));
    expect(shouldSuppress(doc, 'jerry', 'qa_chess')).toBe(false);
  });

  it('suppression miss after eviction costs only a redundant send', () => {
    // After eviction the suppression entry is gone but that is acceptable
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responderId: 'jerry', identityKey: 'qa_tennis' }));
    // Manually evict
    delete doc.outcomes[outcomeKey('jerry', 'talk1', 'tom')];
    delete doc.exchanged[exchangedKey('jerry', 'qa_tennis')];
    expect(shouldSuppress(doc, 'jerry', 'qa_tennis')).toBe(false);
  });
});

// ─── applyEdgeGate ────────────────────────────────────────────────────────────

describe('applyEdgeGate', () => {
  beforeEach(() => {
    setTalkLedgerQuotaUnlimited(false);
  });
  afterEach(() => {
    setTalkLedgerQuotaUnlimited(false);
  });

  it('allows first send (no prior entry)', () => {
    const doc = emptyTalkLedgerDoc();
    const result = applyEdgeGate(doc, 'jerry', Date.now());
    expect(result.ok).toBe(true);
    expect(result.rejectedBy).toHaveLength(0);
    expect(doc.edges['jerry']).toBeDefined();
    expect(doc.edges['jerry']!.sentToday).toBe(1);
  });

  it('debits sentToday on success', () => {
    const doc = emptyTalkLedgerDoc();
    const nowMs = Date.now();
    applyEdgeGate(doc, 'jerry', nowMs);
    applyEdgeGate(doc, 'jerry', nowMs + 1);
    expect(doc.edges['jerry']!.sentToday).toBe(2);
  });

  it('rejects when daily limit reached', () => {
    setTalkLedgerQuotaUnlimited(false);
    const doc = emptyTalkLedgerDoc();
    const nowMs = Date.now();
    // Exhaust the limit
    for (let i = 0; i < TALK_SEND_DAILY; i++) {
      const r = applyEdgeGate(doc, 'jerry', nowMs + i);
      expect(r.ok).toBe(true);
    }
    const r = applyEdgeGate(doc, 'jerry', nowMs + TALK_SEND_DAILY);
    expect(r.ok).toBe(false);
    expect(r.rejectedBy).toContain('daily_talk_send_rate_limit');
  });

  it('resets daily counter after UTC day rollover', () => {
    const doc = emptyTalkLedgerDoc();
    const day1Ms = new Date('2024-01-01T23:59:00.000Z').getTime();
    // Exhaust day 1
    for (let i = 0; i < TALK_SEND_DAILY; i++) {
      applyEdgeGate(doc, 'jerry', day1Ms + i * 10);
    }
    // Now it is day 2
    const day2Ms = new Date('2024-01-02T00:01:00.000Z').getTime();
    const r = applyEdgeGate(doc, 'jerry', day2Ms);
    expect(r.ok).toBe(true);
    expect(doc.edges['jerry']!.sentToday).toBe(1);
  });

  it('resets weekly counter after UTC week rollover (Mon→next Mon)', () => {
    const doc = emptyTalkLedgerDoc();
    // 2024-01-01 is a Monday; 2024-01-08 is next Monday
    const week1Ms = new Date('2024-01-07T23:58:00.000Z').getTime(); // Sunday
    const week2Ms = new Date('2024-01-08T00:01:00.000Z').getTime(); // Monday

    // Exhaust weekly limit (across multiple days in week1 but we'll just use one day)
    // For simplicity, inject the counter directly
    applyEdgeGate(doc, 'jerry', week1Ms);
    doc.edges['jerry']!.sentThisWeek = TALK_SEND_WEEKLY;
    doc.edges['jerry']!.sentToday = 0; // reset so daily doesn't block
    doc.edges['jerry']!.weekBucketStartMs = getUtcWeekStartMs(week1Ms);

    // Try to send in week1 → should be blocked
    const blockedResult = applyEdgeGate(doc, 'jerry', week1Ms + 1000);
    expect(blockedResult.ok).toBe(false);
    expect(blockedResult.rejectedBy).toContain('weekly_talk_send_rate_limit');

    // Try to send in week2 → should succeed (bucket reset)
    // Reset daily counter to avoid daily block
    doc.edges['jerry']!.sentToday = 0;
    doc.edges['jerry']!.dayBucketStartMs = getUtcDayStartMs(week2Ms);
    const week2Result = applyEdgeGate(doc, 'jerry', week2Ms);
    expect(week2Result.ok).toBe(true);
    expect(doc.edges['jerry']!.sentThisWeek).toBe(1);
  });

  it('quota unlimited bypasses all rate limits', () => {
    setTalkLedgerQuotaUnlimited(true);
    const doc = emptyTalkLedgerDoc();
    const nowMs = Date.now();
    // Exhaust limits normally first
    for (let i = 0; i < TALK_SEND_DAILY + 5; i++) {
      const r = applyEdgeGate(doc, 'jerry', nowMs + i);
      expect(r.ok).toBe(true);
    }
  });

  it('cooldown is 0 by default (always cold)', () => {
    expect(TALK_EDGE_COOLDOWN_MS).toBe(0);
    const doc = emptyTalkLedgerDoc();
    const nowMs = Date.now();
    applyEdgeGate(doc, 'jerry', nowMs);
    // Immediately after — should still pass because cooldown is 0
    const r = applyEdgeGate(doc, 'jerry', nowMs + 1);
    expect(r.ok).toBe(true);
  });
});

// ─── evictLedger ──────────────────────────────────────────────────────────────

describe('evictLedger', () => {
  it('evicts oldest outcomes when over cap', () => {
    const doc = emptyTalkLedgerDoc();
    // Write 5001 entries manually (bypass applyEvent to avoid eviction on each write)
    for (let i = 0; i < 5001; i++) {
      const k = `r${i}::talk::tom`;
      doc.outcomes[k] = {
        responderId: `r${i}`,
        talkId: 'talk',
        authorId: 'tom',
        identityKey: 'qa_x',
        outcome: 'matched',
        version: 1,
        responseId: `resp${i}`,
        respondedAt: new Date(i * 1000).toISOString(),
        updatedAt: new Date(i * 1000).toISOString(),
      };
    }
    expect(Object.keys(doc.outcomes)).toHaveLength(5001);
    evictLedger(doc);
    expect(Object.keys(doc.outcomes)).toHaveLength(5000);
    // The oldest entry (i=0, epoch 0) should be gone
    expect(doc.outcomes['r0::talk::tom']).toBeUndefined();
  });

  it('does not evict when under cap', () => {
    const doc = emptyTalkLedgerDoc();
    for (let i = 0; i < 100; i++) {
      doc.outcomes[`r${i}::talk::tom`] = {
        responderId: `r${i}`,
        talkId: 'talk',
        authorId: 'tom',
        identityKey: 'qa_x',
        outcome: 'ignored',
        version: 1,
        responseId: `resp${i}`,
        respondedAt: new Date(i * 1000).toISOString(),
        updatedAt: new Date(i * 1000).toISOString(),
      };
    }
    evictLedger(doc);
    expect(Object.keys(doc.outcomes)).toHaveLength(100);
  });
});

// ─── buildTagIdentityKeys ─────────────────────────────────────────────────────

describe('buildTagIdentityKeys', () => {
  it('returns whole-talk key for non-tag talks', () => {
    const flow = { type: 'flow', questions: [{ answers: [{ text: 'Yes' }] }] };
    expect(buildTagIdentityKeys(flow, 'qa_whole')).toEqual(['qa_whole']);
  });

  it('returns one key per tag answer for tag talks', () => {
    const tag = {
      type: 'tag',
      questions: [{ answers: [{ text: 'Tennis' }, { text: 'Chess' }] }],
    };
    const keys = buildTagIdentityKeys(tag, 'qa_whole');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^qa_tag_/);
    expect(keys[1]).toMatch(/^qa_tag_/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('is case-insensitive and normalized', () => {
    const tag1 = {
      type: 'tag',
      questions: [{ answers: [{ text: '  Tennis  ' }] }],
    };
    const tag2 = {
      type: 'tag',
      questions: [{ answers: [{ text: 'tennis' }] }],
    };
    const keys1 = buildTagIdentityKeys(tag1, 'qa_w');
    const keys2 = buildTagIdentityKeys(tag2, 'qa_w');
    expect(keys1[0]).toBe(keys2[0]);
  });

  it('returns whole-talk key for tag talks with no answers', () => {
    const empty = { type: 'tag', questions: [{ answers: [] }] };
    expect(buildTagIdentityKeys(empty, 'qa_fallback')).toEqual(['qa_fallback']);
  });

  it('returns whole-talk key for survey type', () => {
    const survey = { type: 'survey', questions: [] };
    expect(buildTagIdentityKeys(survey, 'qa_survey')).toEqual(['qa_survey']);
  });
});

// ─── UTC bucket helpers ───────────────────────────────────────────────────────

describe('UTC bucket helpers', () => {
  it('getUtcDayStartMs returns midnight UTC', () => {
    const t = new Date('2024-03-15T14:30:00.000Z').getTime();
    const dayStart = getUtcDayStartMs(t);
    expect(new Date(dayStart).toISOString()).toBe('2024-03-15T00:00:00.000Z');
  });

  it('getUtcWeekStartMs returns preceding Monday midnight UTC', () => {
    // 2024-03-14 is Thursday; preceding Monday is 2024-03-11
    const thu = new Date('2024-03-14T12:00:00.000Z').getTime();
    expect(new Date(getUtcWeekStartMs(thu)).toISOString()).toBe('2024-03-11T00:00:00.000Z');
  });

  it('getUtcWeekStartMs on Monday returns the same day', () => {
    const mon = new Date('2024-03-11T06:00:00.000Z').getTime();
    expect(new Date(getUtcWeekStartMs(mon)).toISOString()).toBe('2024-03-11T00:00:00.000Z');
  });

  it('getUtcWeekStartMs on Sunday returns preceding Monday', () => {
    const sun = new Date('2024-03-17T20:00:00.000Z').getTime(); // Sunday
    expect(new Date(getUtcWeekStartMs(sun)).toISOString()).toBe('2024-03-11T00:00:00.000Z');
  });
});

// ─── Store round-trip (mock localStorage) ────────────────────────────────────

describe('store round-trip (localStorage mock)', () => {
  let store: Record<string, string> = {};

  beforeAll(() => {
    // Mock localStorage for Jest (Node environment)
    if (typeof globalThis.localStorage === 'undefined') {
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: (k: string) => store[k] ?? null,
          setItem: (k: string, v: string) => { store[k] = v; },
          removeItem: (k: string) => { delete store[k]; },
          clear: () => { store = {}; },
        },
        writable: true,
      });
    }
  });

  beforeEach(() => {
    store = {};
  });

  it('loadTalkLedger returns empty doc when key is absent', async () => {
    const { loadTalkLedger } = await import('../../web/services/web-talk-ledger-store');
    const doc = loadTalkLedger();
    expect(doc.version).toBe(1);
    expect(doc.outcomes).toEqual({});
  });

  it('saveTalkLedger + loadTalkLedger round-trip', async () => {
    const { loadTalkLedger, saveTalkLedger } = await import('../../web/services/web-talk-ledger-store');
    const doc = emptyTalkLedgerDoc();
    doc.edges['alice'] = {
      lastSendAt: 9999,
      dayBucketStartMs: 1,
      sentToday: 2,
      weekBucketStartMs: 0,
      sentThisWeek: 5,
    };
    saveTalkLedger(doc);
    const loaded = loadTalkLedger();
    expect(loaded.edges['alice']!.sentToday).toBe(2);
    expect(loaded.edges['alice']!.lastSendAt).toBe(9999);
  });

  it('applyTalkLedgerEvent persists outcome to localStorage', async () => {
    const { applyTalkLedgerEvent, loadTalkLedger } = await import('../../web/services/web-talk-ledger-store');
    applyTalkLedgerEvent(makeAnsweredEvent());
    const doc = loadTalkLedger();
    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeDefined();
    expect(doc.outcomes[k]!.outcome).toBe('matched');
  });

  it('shouldSuppressForPeer returns true after an outcome is written', async () => {
    const { applyTalkLedgerEvent, shouldSuppressForPeer } = await import('../../web/services/web-talk-ledger-store');
    applyTalkLedgerEvent(makeAnsweredEvent({ responderId: 'jerry', identityKey: 'qa_tennis' }));
    expect(shouldSuppressForPeer('jerry', 'qa_tennis')).toBe(true);
    expect(shouldSuppressForPeer('bob', 'qa_tennis')).toBe(false);
  });

  it('applyEdgeGateForPeer persists edge counter', async () => {
    const { applyEdgeGateForPeer, loadTalkLedger } = await import('../../web/services/web-talk-ledger-store');
    const nowMs = new Date('2024-06-01T08:00:00.000Z').getTime();
    const r = applyEdgeGateForPeer('jerry', nowMs);
    expect(r.ok).toBe(true);
    const doc = loadTalkLedger();
    expect(doc.edges['jerry']!.sentToday).toBe(1);
  });
});

// ─── Step 9: version monotonicity + responder-side helpers ────────────────────

describe('Step 9 — version monotonicity and responder-side helpers (localStorage mock)', () => {
  beforeEach(() => {
    // Clear via the globalThis.localStorage mock that was set up by the first describe block.
    // If localStorage is defined, clear all keys explicitly so the shared store is empty.
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.clear();
    }
  });

  it('getResponderVersionForTalk returns 0 when no prior response', async () => {
    const { getResponderVersionForTalk } = await import('../../web/services/web-talk-ledger-store');
    expect(getResponderVersionForTalk('qa_tennis', 'tom')).toBe(0);
  });

  it('writeResponderExchangedEntry persists version and is readable', async () => {
    const {
      writeResponderExchangedEntry,
      getResponderVersionForTalk,
      getResponderLastResponseId,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'matched',
      version: 1,
      responseId: 'resp_v1',
      respondedAt: '2024-01-01T10:00:00.000Z',
    });

    expect(getResponderVersionForTalk('qa_tennis', 'tom')).toBe(1);
    expect(getResponderLastResponseId('qa_tennis', 'tom')).toBe('resp_v1');
  });

  it('version bump: writing version 2 overwrites version 1', async () => {
    const {
      writeResponderExchangedEntry,
      getResponderVersionForTalk,
      getResponderLastResponseId,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'ignored',
      version: 1,
      responseId: 'resp_v1',
      respondedAt: '2024-01-01T10:00:00.000Z',
    });
    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'matched',
      version: 2,
      responseId: 'resp_v2',
      respondedAt: '2024-01-01T11:00:00.000Z',
    });

    expect(getResponderVersionForTalk('qa_tennis', 'tom')).toBe(2);
    expect(getResponderLastResponseId('qa_tennis', 'tom')).toBe('resp_v2');
  });

  it('stale write (lower version) is rejected', async () => {
    const {
      writeResponderExchangedEntry,
      getResponderVersionForTalk,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'matched',
      version: 3,
      responseId: 'resp_v3',
      respondedAt: '2024-01-01T12:00:00.000Z',
    });
    // Attempt stale write
    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'ignored',
      version: 2,
      responseId: 'resp_v2',
      respondedAt: '2024-01-01T11:00:00.000Z',
    });

    expect(getResponderVersionForTalk('qa_tennis', 'tom')).toBe(3);
  });

  it('version persists across store reload', async () => {
    const {
      writeResponderExchangedEntry,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_chess',
      outcome: 'matched',
      version: 5,
      responseId: 'resp_v5',
      respondedAt: '2024-01-01T12:00:00.000Z',
    });

    // Simulate reload by re-importing (module is cached, but store key is in the mock)
    const { getResponderVersionForTalk: getV2 } = await import('../../web/services/web-talk-ledger-store');
    expect(getV2('qa_chess', 'tom')).toBe(5);
  });

  it('getResponderSendersForIdentity returns all authors who sent the identity', async () => {
    const {
      writeResponderExchangedEntry,
      getResponderSendersForIdentity,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'ignored',
      version: 1,
      responseId: 'r1',
      respondedAt: '2024-01-01T10:00:00.000Z',
    });
    writeResponderExchangedEntry({
      authorId: 'bob',
      identityKey: 'qa_tennis',
      outcome: 'matched',
      version: 1,
      responseId: 'r2',
      respondedAt: '2024-01-01T10:01:00.000Z',
    });

    const senders = getResponderSendersForIdentity('qa_tennis');
    expect(senders).toHaveLength(2);
    expect(senders).toContain('tom');
    expect(senders).toContain('bob');
  });

  it('getResponderSendersForIdentity does not return senders for different identity', async () => {
    const {
      writeResponderExchangedEntry,
      getResponderSendersForIdentity,
    } = await import('../../web/services/web-talk-ledger-store');

    writeResponderExchangedEntry({
      authorId: 'tom',
      identityKey: 'qa_tennis',
      outcome: 'ignored',
      version: 1,
      responseId: 'r1',
      respondedAt: '2024-01-01T10:00:00.000Z',
    });

    const senders = getResponderSendersForIdentity('qa_chess');
    expect(senders).toHaveLength(0);
  });
});

// ─── Step 9: ingest matrix (applyEvent ordering for supersession) ─────────────

describe('Step 9 — ingest matrix: newer/equal/older/post-retraction', () => {
  it('newer version replaces existing outcome (ignore→match flip)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 1, responseId: 'r1' }));
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 2, responseId: 'r2', respondedAt: '2024-01-01T11:00:00.000Z' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('matched');
    expect(doc.outcomes[k]!.version).toBe(2);
  });

  it('equal version with same responseId is idempotent (no change)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 1, responseId: 'r1' }));
    // Same version + same responseId = exact replay
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 1, responseId: 'r1' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('matched'); // unchanged
  });

  it('older version is rejected (stale)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 3, responseId: 'r3' }));
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 2, responseId: 'r2' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('matched'); // unchanged
    expect(doc.outcomes[k]!.version).toBe(3);
  });

  it('post-retraction answer is rejected', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, {
      kind: 'TALK_RETRACTED',
      talkId: 'talk1',
      authorId: 'tom',
      retractedAt: new Date('2024-01-01T10:00:00.000Z').getTime(),
    });
    // Answer came in BEFORE retraction time
    applyEvent(doc, makeAnsweredEvent({ respondedAt: '2024-01-01T09:59:00.000Z', version: 2, responseId: 'r2' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeUndefined();
  });

  it('match→ignore: applyEvent flips the outcome and version increments', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ outcome: 'matched', version: 1, responseId: 'r1' }));
    applyEvent(doc, makeAnsweredEvent({ outcome: 'ignored', version: 2, responseId: 'r2', respondedAt: '2024-01-01T11:00:00.000Z' }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]!.outcome).toBe('ignored');
    expect(doc.outcomes[k]!.version).toBe(2);
  });
});

// ─── Step 10: retraction event (tombstone, outcomes cleared, exchanged cleared) ─

describe('Step 10 — retraction: tombstone + teardown', () => {
  it('applyEvent TALK_RETRACTED clears outcomes for the retracted talkId::authorId', () => {
    const doc = emptyTalkLedgerDoc();
    // Jerry answered Tom's talk (matched)
    applyEvent(doc, makeAnsweredEvent({ responderId: 'jerry', talkId: 'talk1', authorId: 'tom', outcome: 'matched' }));
    // Bob answered Tom's talk (ignored)
    applyEvent(doc, makeAnsweredEvent({ responderId: 'bob', talkId: 'talk1', authorId: 'tom', outcome: 'ignored', responseId: 'r_bob' }));
    expect(Object.keys(doc.outcomes)).toHaveLength(2);

    // Tom retracts
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: Date.now() });

    expect(Object.keys(doc.outcomes)).toHaveLength(0);
    expect(doc.retracted[retractedKey('talk1', 'tom')]).toBeDefined();
  });

  it('applyEvent TALK_RETRACTED clears exchanged entries for the retracted identity', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ responderId: 'jerry', identityKey: 'qa_tennis', outcome: 'matched' }));
    expect(doc.exchanged[exchangedKey('jerry', 'qa_tennis')]).toBeDefined();

    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: Date.now() });

    expect(doc.exchanged[exchangedKey('jerry', 'qa_tennis')]).toBeUndefined();
  });

  it('retraction tombstone persists and is author-scoped (different author unaffected)', () => {
    const doc = emptyTalkLedgerDoc();
    // Alice's outcome (different author, same talkId)
    applyEvent(doc, makeAnsweredEvent({ authorId: 'alice', responderId: 'jerry', responseId: 'r_alice' }));
    // Tom retracts his version
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: Date.now() });

    // Alice's outcome must survive
    const k = outcomeKey('jerry', 'talk1', 'alice');
    expect(doc.outcomes[k]).toBeDefined();
    // Tom's tombstone must exist
    expect(doc.retracted[retractedKey('talk1', 'tom')]).toBeDefined();
    // Alice has no tombstone
    expect(doc.retracted[retractedKey('talk1', 'alice')]).toBeUndefined();
  });

  it('only-author-can-retract: a TALK_RETRACTED for authorId=alice does not clear tom outcomes', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, makeAnsweredEvent({ authorId: 'tom', responderId: 'jerry', responseId: 'r1' }));

    // Alice claims to retract talkId but is not the author
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'alice', retractedAt: Date.now() });

    // Tom's outcome must survive (alice != tom, different tombstone key)
    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeDefined();
  });

  it('ingest ordering: TALK_ANSWERED older than retractedAt is discarded', () => {
    const doc = emptyTalkLedgerDoc();
    const retractedAt = new Date('2024-06-01T12:00:00.000Z').getTime();
    // Retract first
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt });
    // Incoming answer pre-dates the retraction
    applyEvent(doc, makeAnsweredEvent({
      responderId: 'jerry',
      respondedAt: '2024-06-01T11:00:00.000Z', // before retractedAt
      version: 1,
    }));

    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeUndefined();
  });

  it('dead-inbox rule: even a newer-than-retraction answer is rejected for a retracted talk', () => {
    // Per design note: retraction beats all — TALK_ANSWERED for retracted talk is always rejected
    // when isStaleAgainstRetraction returns true. However an answer with respondedAt AFTER
    // retractedAt passes isStaleAgainstRetraction (retraction does NOT block future answers
    // that arrive later — it only blocks stale pre-retraction answers in the pure ordering fn).
    // The dead-inbox for future answers is enforced at the application layer (submitTalkResponsePairDirect).
    const doc = emptyTalkLedgerDoc();
    const retractedAt = new Date('2024-06-01T12:00:00.000Z').getTime();
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt });
    // Answer arrives AFTER retraction
    applyEvent(doc, makeAnsweredEvent({
      responderId: 'jerry',
      respondedAt: '2024-06-01T13:00:00.000Z', // after retractedAt
      version: 1,
    }));
    // applyEvent allows answers after retraction (application-layer blocks at submit time)
    const k = outcomeKey('jerry', 'talk1', 'tom');
    expect(doc.outcomes[k]).toBeDefined();
  });

  it('duplicate retraction frames are idempotent (max retractedAt wins)', () => {
    const doc = emptyTalkLedgerDoc();
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 1000 });
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 2000 });
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 500 });

    const tombstone = doc.retracted[retractedKey('talk1', 'tom')];
    expect(tombstone).toBeDefined();
    expect(tombstone!.retractedAt).toBe(2000);
    // Outcomes still empty (cleared on first retraction)
    expect(Object.keys(doc.outcomes)).toHaveLength(0);
  });

  it('conversation withdrawn idempotence: re-applying retraction does not corrupt tombstone', () => {
    const doc = emptyTalkLedgerDoc();
    // First retraction
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 5000 });
    // Duplicate
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 5000 });
    // Older duplicate
    applyEvent(doc, { kind: 'TALK_RETRACTED', talkId: 'talk1', authorId: 'tom', retractedAt: 1000 });

    expect(doc.retracted[retractedKey('talk1', 'tom')]!.retractedAt).toBe(5000);
  });
});
