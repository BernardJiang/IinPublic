import {
  boundRecentWires,
  buildConversationDigest,
  computeMissingForPeer,
  DEFAULT_RECONCILE_WINDOW,
  messageIntroducesGap,
  selectNewBackfill,
  type ReconcileMessage,
} from '../../shared/conversation-reconcile';

function msg(id: string, over: Partial<ReconcileMessage> = {}): ReconcileMessage {
  return {
    id,
    senderId: 'alice',
    text: `ct(${id})`,
    timestamp: `2026-06-13T00:00:0${id.slice(-1)}.000Z`,
    channel: 'public',
    transport: 'direct-p2p',
    encryption: 'sea-ecdh-v1',
    ...over,
  };
}

describe('conversation-reconcile (Phase 5 peer↔peer convergence)', () => {
  describe('buildConversationDigest', () => {
    it('collects unique, non-empty ids for the conversation', () => {
      const d = buildConversationDigest('c1', [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: '' }]);
      expect(d.conversationId).toBe('c1');
      expect(new Set(d.messageIds)).toEqual(new Set(['a', 'b']));
      expect(d.messageIds.length).toBe(2);
    });
  });

  describe('computeMissingForPeer', () => {
    it('returns local messages the remote digest lacks', () => {
      const local = [msg('a'), msg('b'), msg('c')];
      const remoteDigest = buildConversationDigest('c1', [{ id: 'a' }]);
      const missing = computeMissingForPeer('c1', local, remoteDigest);
      expect(missing.map((m) => m.id)).toEqual(['b', 'c']);
    });

    it('returns nothing when the remote already has everything', () => {
      const local = [msg('a'), msg('b')];
      const remoteDigest = buildConversationDigest('c1', [{ id: 'a' }, { id: 'b' }]);
      expect(computeMissingForPeer('c1', local, remoteDigest)).toEqual([]);
    });

    it('ignores a digest for a different conversation', () => {
      const local = [msg('a')];
      const remoteDigest = buildConversationDigest('OTHER', []);
      expect(computeMissingForPeer('c1', local, remoteDigest)).toEqual([]);
    });

    it('dedups repeated local ids', () => {
      const local = [msg('a'), msg('a'), msg('b')];
      const missing = computeMissingForPeer('c1', local, buildConversationDigest('c1', []));
      expect(missing.map((m) => m.id)).toEqual(['a', 'b']);
    });
  });

  describe('selectNewBackfill', () => {
    it('keeps only messages not already held locally', () => {
      const backfill = [msg('a'), msg('b'), msg('c')];
      const fresh = selectNewBackfill(['b'], backfill);
      expect(fresh.map((m) => m.id)).toEqual(['a', 'c']);
    });

    it('accepts a Set of local ids and preserves order', () => {
      const fresh = selectNewBackfill(new Set(['x']), [msg('z'), msg('x'), msg('y')]);
      expect(fresh.map((m) => m.id)).toEqual(['z', 'y']);
    });

    it('returns [] when all backfill is already held', () => {
      expect(selectNewBackfill(['a', 'b'], [msg('a'), msg('b')])).toEqual([]);
    });
  });

  describe('boundRecentWires (Phase 5 long-conversation bound)', () => {
    const at = (iso: string, id: string): ReconcileMessage => msg(id, { timestamp: iso });

    it('returns all messages in ascending time order when under the limit', () => {
      const out = boundRecentWires(
        [at('2026-06-13T00:00:03.000Z', 'c'), at('2026-06-13T00:00:01.000Z', 'a'), at('2026-06-13T00:00:02.000Z', 'b')],
        10,
      );
      expect(out.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    });

    it('keeps only the most-recent `limit` messages (oldest dropped)', () => {
      const out = boundRecentWires(
        [at('2026-06-13T00:00:01.000Z', 'a'), at('2026-06-13T00:00:02.000Z', 'b'), at('2026-06-13T00:00:03.000Z', 'c')],
        2,
      );
      expect(out.map((m) => m.id)).toEqual(['b', 'c']);
    });

    it('breaks timestamp ties by id for deterministic ordering', () => {
      const out = boundRecentWires(
        [at('2026-06-13T00:00:01.000Z', 'y'), at('2026-06-13T00:00:01.000Z', 'x')],
        10,
      );
      expect(out.map((m) => m.id)).toEqual(['x', 'y']);
    });

    it('treats limit <= 0 as unbounded', () => {
      const ms = Array.from({ length: 5 }, (_, i) => at(`2026-06-13T00:00:0${i}.000Z`, `m${i}`));
      expect(boundRecentWires(ms, 0)).toHaveLength(5);
    });

    it('exposes a sane default window', () => {
      expect(DEFAULT_RECONCILE_WINDOW).toBeGreaterThan(0);
    });

    it('a bounded digest still converges the recent window between two peers', () => {
      // 4 messages; window = 2. Each peer is missing one of the two most-recent messages.
      const m1 = at('2026-06-13T00:00:01.000Z', 'm1');
      const m2 = at('2026-06-13T00:00:02.000Z', 'm2');
      const m3 = at('2026-06-13T00:00:03.000Z', 'm3');
      const m4 = at('2026-06-13T00:00:04.000Z', 'm4');
      const aRecent = boundRecentWires([m1, m2, m3], 2); // [m2, m3]
      const bRecent = boundRecentWires([m1, m2, m4], 2); // [m2, m4]

      const aToB = computeMissingForPeer('c1', aRecent, buildConversationDigest('c1', bRecent));
      const bToA = computeMissingForPeer('c1', bRecent, buildConversationDigest('c1', aRecent));
      expect(aToB.map((m) => m.id)).toEqual(['m3']);
      expect(bToA.map((m) => m.id)).toEqual(['m4']);
    });
  });

  describe('messageIntroducesGap (Phase 5 re-digest trigger)', () => {
    it('flags an inbound message whose predecessor we do not hold', () => {
      expect(messageIntroducesGap(['a'], { senderId: 'bob', prevSeen: 'X' }, 'alice')).toBe(true);
    });

    it('does not flag when the predecessor is already held', () => {
      expect(messageIntroducesGap(['a', 'X'], { senderId: 'bob', prevSeen: 'X' }, 'alice')).toBe(false);
    });

    it('never flags our own echoed messages', () => {
      expect(messageIntroducesGap([], { senderId: 'alice', prevSeen: 'X' }, 'alice')).toBe(false);
    });

    it('does not flag a message with no predecessor (thread head)', () => {
      expect(messageIntroducesGap([], { senderId: 'bob' }, 'alice')).toBe(false);
      expect(messageIntroducesGap([], { senderId: 'bob', prevSeen: '' }, 'alice')).toBe(false);
    });

    it('accepts a Set of local ids', () => {
      expect(messageIntroducesGap(new Set(['X']), { senderId: 'bob', prevSeen: 'X' }, 'alice')).toBe(false);
    });
  });

  it('two peers converge to the same id set after a symmetric exchange (no hub)', () => {
    // A holds {a,b}; B holds {b,c}. After exchanging digests + backfill, both hold {a,b,c}.
    const aMsgs = [msg('a'), msg('b')];
    const bMsgs = [msg('b'), msg('c')];

    const aDigest = buildConversationDigest('c1', aMsgs);
    const bDigest = buildConversationDigest('c1', bMsgs);

    // A receives B's digest → sends B what B is missing ({a}). B applies it.
    const aSendsToB = computeMissingForPeer('c1', aMsgs, bDigest);
    const bApplies = selectNewBackfill(bMsgs.map((m) => m.id), aSendsToB);
    const bFinal = [...bMsgs, ...bApplies];

    // B receives A's digest → sends A what A is missing ({c}). A applies it.
    const bSendsToA = computeMissingForPeer('c1', bMsgs, aDigest);
    const aApplies = selectNewBackfill(aMsgs.map((m) => m.id), bSendsToA);
    const aFinal = [...aMsgs, ...aApplies];

    const ids = (ms: ReconcileMessage[]) => new Set(ms.map((m) => m.id));
    expect(ids(aFinal)).toEqual(new Set(['a', 'b', 'c']));
    expect(ids(bFinal)).toEqual(new Set(['a', 'b', 'c']));
    // Convergence is idempotent: re-running the exchange sends nothing new.
    expect(computeMissingForPeer('c1', aFinal, buildConversationDigest('c1', bFinal))).toEqual([]);
    expect(computeMissingForPeer('c1', bFinal, buildConversationDigest('c1', aFinal))).toEqual([]);
  });
});
