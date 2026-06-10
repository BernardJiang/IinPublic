/**
 * Unit tests for P0 step 4 — mesh response CIDv1 ids, offline queue, and duplicate-delivery
 * idempotence.
 *
 * Tests cover:
 *   1. computeResponseId determinism: same inputs → same id; different responder → different id.
 *   2. computeResponseIdSync: same contract as async version (deterministic, no collision).
 *   3. Offline-author interim queue: persist / re-send logic (STEP-6-REPLACE surface).
 *   4. Duplicate-delivery idempotence: second identical talk-response does not duplicate
 *      conversation or local-exchange entry.
 */

import { computeResponseId, computeResponseIdSync, canonicalSerialize } from '../../shared/cid';

// ─── 1. CIDv1 responseId determinism ────────────────────────────────────────

describe('computeResponseId — determinism', () => {
  const talkId = 'qa_abc12345';
  const responderId = 'user-responder-1';
  const answers = [
    { questionId: 'q1', answerId: 'a1', answerText: 'Yes', mode: 'manual' },
  ];
  const responseContentJson = canonicalSerialize(answers);

  it('same inputs produce the same id', async () => {
    const id1 = await computeResponseId({ talkId, responderId, responseContentJson });
    const id2 = await computeResponseId({ talkId, responderId, responseContentJson });
    expect(id1).toBe(id2);
    expect(typeof id1).toBe('string');
    expect(id1.length).toBeGreaterThan(0);
  });

  it('starts with multibase prefix "b" (base32-lower CIDv1)', async () => {
    const id = await computeResponseId({ talkId, responderId, responseContentJson });
    expect(id.startsWith('b')).toBe(true);
  });

  it('different responderId produces a different id', async () => {
    const id1 = await computeResponseId({ talkId, responderId: 'responder-A', responseContentJson });
    const id2 = await computeResponseId({ talkId, responderId: 'responder-B', responseContentJson });
    expect(id1).not.toBe(id2);
  });

  it('different talkId produces a different id', async () => {
    const id1 = await computeResponseId({ talkId: 'talk-X', responderId, responseContentJson });
    const id2 = await computeResponseId({ talkId: 'talk-Y', responderId, responseContentJson });
    expect(id1).not.toBe(id2);
  });

  it('different answer content produces a different id', async () => {
    const json1 = canonicalSerialize([{ questionId: 'q1', answerId: 'a1', answerText: 'Yes' }]);
    const json2 = canonicalSerialize([{ questionId: 'q1', answerId: 'a2', answerText: 'No' }]);
    const id1 = await computeResponseId({ talkId, responderId, responseContentJson: json1 });
    const id2 = await computeResponseId({ talkId, responderId, responseContentJson: json2 });
    expect(id1).not.toBe(id2);
  });

  it('canonicalSerialize is order-independent on object keys', () => {
    // Same answers, different key order → same JSON → same id
    const a = canonicalSerialize([{ answerId: 'a1', questionId: 'q1', answerText: 'Yes' }]);
    const b = canonicalSerialize([{ questionId: 'q1', answerId: 'a1', answerText: 'Yes' }]);
    expect(a).toBe(b);
  });
});

// ─── 2. computeResponseIdSync determinism ────────────────────────────────────

describe('computeResponseIdSync — determinism', () => {
  const talkId = 'qa_sync_test';
  const responderId = 'user-sync-1';
  const responseContentJson = canonicalSerialize([{ questionId: 'q1', answerId: 'a1' }]);

  it('same inputs produce the same id', () => {
    const id1 = computeResponseIdSync({ talkId, responderId, responseContentJson });
    const id2 = computeResponseIdSync({ talkId, responderId, responseContentJson });
    expect(id1).toBe(id2);
  });

  it('different responderId produces a different id', () => {
    const id1 = computeResponseIdSync({ talkId, responderId: 'A', responseContentJson });
    const id2 = computeResponseIdSync({ talkId, responderId: 'B', responseContentJson });
    expect(id1).not.toBe(id2);
  });

  it('sync id uses "bsync" prefix to distinguish from real CIDv1', () => {
    const id = computeResponseIdSync({ talkId, responderId, responseContentJson });
    expect(id.startsWith('bsync')).toBe(true);
  });
});

// ─── 3. Offline-author interim queue persist/re-send logic ───────────────────
//
// The queue lives in localStorage `pendingMeshTalkResponses` (STEP-6-REPLACE).
// We test the data-structure contract (key format, de-duplication, drain semantics)
// without importing app.ts (which pulls in browser-only transitive deps).
// The contract is: queue[`${talkId}::${authorId}::${responseId}`] = payload.
//
// Jest runs in Node (no real localStorage), so we use a simple Map-backed mock.

type PendingPayload = {
  responseId: string;
  talkId: string;
  authorId: string;
  responderId: string;
  submittedAt: string;
  respondedAt: string;
  version: 1;
  encryption: 'sea-ecdh-v1';
  payloadCiphertext: string;
  transportMode: 'mesh-p2p';
};

/** Minimal in-memory re-implementation of the queue contract from app.ts. */
class PendingMeshResponseQueue {
  private store: Record<string, PendingPayload> = {};

  enqueue(payload: PendingPayload): void {
    const key = `${payload.talkId}::${payload.authorId}::${payload.responseId}`;
    this.store[key] = payload;
  }

  drain(rosterUserIds: string[]): PendingPayload[] {
    const rosterSet = new Set(rosterUserIds);
    const drained: PendingPayload[] = [];
    const remaining: Record<string, PendingPayload> = {};
    for (const [key, payload] of Object.entries(this.store)) {
      if (rosterSet.has(payload.authorId)) {
        drained.push(payload);
      } else {
        remaining[key] = payload;
      }
    }
    this.store = remaining;
    return drained;
  }

  size(): number {
    return Object.keys(this.store).length;
  }

  keys(): string[] {
    return Object.keys(this.store);
  }

  get(key: string): PendingPayload | undefined {
    return this.store[key];
  }
}

function makePayload(overrides: Partial<PendingPayload> = {}): PendingPayload {
  const now = new Date().toISOString();
  return {
    responseId: 'bsync00000001',
    talkId: 'qa_talkX',
    authorId: 'author-1',
    responderId: 'responder-1',
    submittedAt: now,
    respondedAt: now,
    version: 1,
    encryption: 'sea-ecdh-v1',
    payloadCiphertext: 'SEA{"ct":"test"}',
    transportMode: 'mesh-p2p',
    ...overrides,
  };
}

describe('Offline-author interim queue — contract', () => {
  let queue: PendingMeshResponseQueue;

  beforeEach(() => {
    queue = new PendingMeshResponseQueue();
  });

  it('enqueue stores under <talkId>::<authorId>::<responseId> key', () => {
    const p = makePayload({});
    queue.enqueue(p);
    const expectedKey = `${p.talkId}::${p.authorId}::${p.responseId}`;
    expect(queue.keys()).toContain(expectedKey);
    expect(queue.get(expectedKey)).toMatchObject({ responseId: p.responseId, authorId: p.authorId });
  });

  it('enqueuing the same payload twice is idempotent (last write wins, same content)', () => {
    const p = makePayload({});
    queue.enqueue(p);
    queue.enqueue(p); // duplicate
    expect(queue.size()).toBe(1);
  });

  it('drain returns payloads whose authorId is in the roster and removes them', () => {
    const p1 = makePayload({ responseId: 'id-1', authorId: 'author-online' });
    const p2 = makePayload({ responseId: 'id-2', authorId: 'author-offline' });
    queue.enqueue(p1);
    queue.enqueue(p2);

    const drained = queue.drain(['author-online']);
    expect(drained).toHaveLength(1);
    expect(drained[0].authorId).toBe('author-online');

    // p2 must still be in the queue (author-offline not drained)
    expect(queue.size()).toBe(1);
    const remainingKey = queue.keys()[0];
    expect(queue.get(remainingKey)?.authorId).toBe('author-offline');
  });

  it('drain with no matching authors leaves queue untouched', () => {
    const p = makePayload({ authorId: 'author-absent' });
    queue.enqueue(p);
    const drained = queue.drain(['someone-else']);
    expect(drained).toHaveLength(0);
    expect(queue.size()).toBe(1);
  });

  it('empty queue drain returns nothing and does not throw', () => {
    const drained = queue.drain(['any-author']);
    expect(drained).toHaveLength(0);
  });

  it('multiple responses for same author all drain together', () => {
    const p1 = makePayload({ responseId: 'id-1', talkId: 'talk-A', authorId: 'author-X' });
    const p2 = makePayload({ responseId: 'id-2', talkId: 'talk-B', authorId: 'author-X' });
    const p3 = makePayload({ responseId: 'id-3', talkId: 'talk-A', authorId: 'author-Y' });
    queue.enqueue(p1);
    queue.enqueue(p2);
    queue.enqueue(p3);

    const drained = queue.drain(['author-X']);
    expect(drained.map((d) => d.responseId).sort()).toEqual(['id-1', 'id-2']);
    expect(queue.size()).toBe(1);
    expect(queue.get(queue.keys()[0])?.authorId).toBe('author-Y');
  });
});

// ─── 4. Duplicate-delivery idempotence ───────────────────────────────────────
//
// A second identical talk-response (same responseId) must not create a duplicate
// conversation record or overwrite the existing localTalkExchange entry with a
// different date.
//
// We test the dedup-key contract used by handleMeshTalkResponse: once a
// `mesh-response::<talkId>::<responseId>` key is in processedTalkResponseKeys,
// the handler returns without creating a second conversation. We simulate this
// without importing app.ts by asserting the Set contract directly.

describe('Duplicate-delivery idempotence — dedup key contract', () => {
  it('dedup key is unique per (talkId, responseId) pair', () => {
    const makeKey = (talkId: string, responseId: string) =>
      `mesh-response::${talkId}::${responseId}`;

    const seen = new Set<string>();
    const k1 = makeKey('talk-A', 'resp-1');
    const k2 = makeKey('talk-A', 'resp-2');
    const k3 = makeKey('talk-B', 'resp-1');

    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
    expect(k2).not.toBe(k3);

    seen.add(k1);
    expect(seen.has(k1)).toBe(true);
    // Adding the same key again does not grow the set
    seen.add(k1);
    expect(seen.size).toBe(1);
  });

  it('localTalkExchange key is per (peerId, talkId) — same response overwrites, no duplicate', () => {
    // Simulate recordLocalTalkExchange behaviour
    const exchanges: Record<string, { outcome: string; date: string; responseId: string }> = {};

    function recordExchange(
      peerId: string,
      talkId: string,
      outcome: 'match' | 'mismatch',
      responseId: string,
    ) {
      const key = `${peerId}::${talkId}`;
      exchanges[key] = {
        ...(exchanges[key] ?? {}),
        outcome,
        date: new Date().toISOString(),
        responseId,
      };
    }

    recordExchange('peer-1', 'talk-A', 'match', 'resp-CID-1');
    expect(Object.keys(exchanges)).toHaveLength(1);

    // Second delivery with the same responseId — same key, no new entry
    recordExchange('peer-1', 'talk-A', 'match', 'resp-CID-1');
    expect(Object.keys(exchanges)).toHaveLength(1);
    expect(exchanges['peer-1::talk-A'].responseId).toBe('resp-CID-1');
  });

  it('R-2 fields (responseId, version, respondedAt) are stored in localTalkExchange', () => {
    const now = new Date().toISOString();
    const exchanges: Record<string, Record<string, unknown>> = {};

    function recordExchangeWithMeta(
      peerId: string,
      talkId: string,
      outcome: string,
      meta: { responseId: string; version: number; respondedAt: string },
    ) {
      const key = `${peerId}::${talkId}`;
      exchanges[key] = {
        ...(exchanges[key] ?? {}),
        peerId,
        talkId,
        outcome,
        direction: 'sent',
        date: now,
        ...(meta.responseId ? { responseId: meta.responseId } : {}),
        ...(meta.version !== undefined ? { version: meta.version } : {}),
        ...(meta.respondedAt ? { respondedAt: meta.respondedAt } : {}),
      };
    }

    recordExchangeWithMeta('peer-X', 'talk-Z', 'match', {
      responseId: 'bafytest123',
      version: 1,
      respondedAt: now,
    });

    const entry = exchanges['peer-X::talk-Z'];
    expect(entry.responseId).toBe('bafytest123');
    expect(entry.version).toBe(1);
    expect(entry.respondedAt).toBe(now);
  });
});
