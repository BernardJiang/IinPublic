/**
 * TODO §S Item 4: unit coverage for message checkpoint creation and pruning
 * (docs/design/section-s-merkle-checkpoint-pruning-design-note.md).
 *
 * Two layers, tested separately:
 *  - `planMessageCheckpoint`/`planMessagePruning` are pure (no Gun at all — same
 *    "no DOM, no Gun, no WebRTC" philosophy as this file's sibling
 *    conversation-reconcile.ts) and carry the actual window/root/retention math, so
 *    they're tested directly with plain arrays.
 *  - `GunMessageStore`'s own Gun wiring (does `putMessageRecord` write a checkpoint to
 *    the right path, in the right shape, and does pruning delete the right message
 *    nodes) is tested against a small synchronous fake Gun-chain double, not a real Gun
 *    instance: a real in-memory `Gun()` (no radisk/peers/AXE) was tried first and found
 *    unreliable for fresh multi-level `.get().get()...` chains under Jest's node
 *    environment (a `.map()` read over freshly-written nested children never resolved,
 *    even after warming up every intermediate node) — a limitation of that bare
 *    configuration, not of the production code, which runs against a real browser Gun
 *    instance with actual storage/peers. The fake below implements just get/put/once/map
 *    with real nested-node semantics, which is all GunMessageStore's write/read paths use.
 */
import {
  GunMessageStore,
  MESSAGE_CHECKPOINT_INTERVAL,
  MESSAGE_RETENTION_WINDOW,
  planMessageCheckpoint,
  planMessagePruning,
  type ConversationMessageWire,
  type MessageCheckpointContent,
} from '../../web/services/gun-message-store';
import type { WebGunService } from '../../web/services/web-gun-service';
import { computeMerkleRoot, sha256Hex } from '../../shared/merkle-checkpoint';

describe('planMessageCheckpoint / planMessagePruning (TODO §S Item 4, pure logic)', () => {
  function wires(count: number, offset = 0): { id: string; text: string }[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `msg-${String(i + offset).padStart(4, '0')}`,
      text: `plaintext-${i + offset}`,
    }));
  }

  it('returns null before MESSAGE_CHECKPOINT_INTERVAL new messages exist', async () => {
    const plan = await planMessageCheckpoint(wires(MESSAGE_CHECKPOINT_INTERVAL - 1), 0, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeNull();
  });

  it('builds a self-consistent checkpoint exactly at the interval', async () => {
    const all = wires(MESSAGE_CHECKPOINT_INTERVAL);
    const plan = await planMessageCheckpoint(all, 0, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeTruthy();
    const { content, newLastCheckpointedCount } = plan!;
    expect(newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(content.count).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(content.rangeStartId).toBe('msg-0000');
    expect(content.rangeEndId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL - 1).padStart(4, '0')}`);
    expect(content.leafHashes).toHaveLength(MESSAGE_CHECKPOINT_INTERVAL);

    const expectedLeaves = await Promise.all(all.map(async (w) => `${w.id}:${await sha256Hex(w.text)}`));
    expect(content.leafHashes).toEqual(expectedLeaves);
    const recomputedRoot = await computeMerkleRoot(content.leafHashes);
    expect(content.merkleRoot).toBe(recomputedRoot);
  });

  it('continues checkpointing when the wire list no longer contains a pruned prefix', async () => {
    const retained = wires(MESSAGE_CHECKPOINT_INTERVAL * 2).slice(MESSAGE_CHECKPOINT_INTERVAL);
    const plan = await planMessageCheckpoint(
      retained,
      MESSAGE_CHECKPOINT_INTERVAL,
      MESSAGE_CHECKPOINT_INTERVAL,
      MESSAGE_CHECKPOINT_INTERVAL,
    );

    expect(plan?.newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL * 2);
    expect(plan?.content.rangeStartId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL).padStart(4, '0')}`);
  });

  it('takes the next window after an existing checkpoint, not the whole backlog', async () => {
    const all = wires(MESSAGE_CHECKPOINT_INTERVAL * 2);
    const plan = await planMessageCheckpoint(all, MESSAGE_CHECKPOINT_INTERVAL, MESSAGE_CHECKPOINT_INTERVAL);
    expect(plan).toBeTruthy();
    const { content, newLastCheckpointedCount } = plan!;
    expect(newLastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL * 2);
    expect(content.rangeStartId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL).padStart(4, '0')}`);
    expect(content.rangeEndId).toBe(`msg-${String(MESSAGE_CHECKPOINT_INTERVAL * 2 - 1).padStart(4, '0')}`);
  });

  it('prunes nothing before the retention window is exceeded', () => {
    // 3 checkpoints' worth, all within MESSAGE_RETENTION_WINDOW (200).
    const plan = planMessagePruning(MESSAGE_CHECKPOINT_INTERVAL * 3, MESSAGE_CHECKPOINT_INTERVAL * 3, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toBeNull();
  });

  it('computes the deletable boundary as min(lastCheckpointedCount, total - retentionWindow)', () => {
    // 5 checkpoints (250 messages), all checkpointed, retention window 200 -> 50 deletable.
    const plan = planMessagePruning(250, 250, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 50 });
  });

  it('does not re-deliver an already-pruned boundary', () => {
    // Same totals as above, but 50 have already been pruned -> nothing new.
    const plan = planMessagePruning(250, 250, 50, MESSAGE_RETENTION_WINDOW);
    expect(plan).toBeNull();
  });

  it('advances the boundary as more checkpoints land', () => {
    // 6 checkpoints (300 messages), 50 already pruned -> boundary advances to 100.
    const plan = planMessagePruning(300, 300, 50, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 100 });
  });

  it('never prunes past what has actually been checkpointed', () => {
    // total - retentionWindow (300-200=100) would allow pruning through 100, but only 80
    // messages are actually checkpointed yet -> capped at 80, not 100.
    const plan = planMessagePruning(300, 80, 0, MESSAGE_RETENTION_WINDOW);
    expect(plan).toEqual({ deletableThrough: 80 });
  });
});

/**
 * Minimal synchronous fake Gun-chain double: real nested-edge semantics (`.get(key)`
 * creates/returns a child node, keyed independently at each level), `.put(data)` merges
 * fields (or tombstones on `.put(null)`, matching the store's own delete convention),
 * `.once(cb)` replays the current value synchronously, `.map().once(cb)` iterates live
 * (non-null) children. This is what GunMessageStore's write/read paths actually use.
 */
class FakeGunNode {
  private children = new Map<string, FakeGunNode>();
  private value: Record<string, unknown> | null | undefined = undefined;

  get(key: string): FakeGunNode {
    let child = this.children.get(key);
    if (!child) {
      child = new FakeGunNode();
      this.children.set(key, child);
    }
    return child;
  }

  put(data: Record<string, unknown> | null, cb?: (ack: { err?: string }) => void): void {
    if (data === null) {
      this.value = null;
    } else {
      this.value = { ...(this.value && typeof this.value === 'object' ? this.value : {}), ...data };
    }
    if (cb) cb({});
  }

  once(cb: (data: any) => void): void {
    cb(this.value ?? undefined);
  }

  map(): { once: (cb: (data: any, key: string) => void) => void } {
    return {
      once: (cb: (data: any, key: string) => void) => {
        for (const [key, child] of this.children.entries()) {
          child.once((data) => {
            if (data) cb(data, key);
          });
        }
      },
    };
  }
}

function makeGunService(): { gunService: WebGunService; root: FakeGunNode } {
  const root = new FakeGunNode();
  const gunService = {
    getGun: () => root,
    getStoredPair: () => null,
    getPublicUser: async () => ({ epub: undefined }),
  } as unknown as WebGunService;
  return { gunService, root };
}

function pairId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

function makeWire(idx: number, senderId: string): ConversationMessageWire {
  return {
    id: `msg-${String(idx).padStart(4, '0')}`,
    senderId,
    text: `plaintext-${idx}`,
    timestamp: new Date(Date.parse('2026-01-01T00:00:00.000Z') + idx * 1000).toISOString(),
    channel: 'public',
    transport: 'direct-p2p',
  };
}

describe('GunMessageStore Gun wiring (TODO §S Item 4)', () => {
  const senderId = 'msg-test-sender';
  const otherUserId = 'msg-test-other';
  const conversationId = 'conv-checkpoint-test';

  function conversationNode(root: FakeGunNode): FakeGunNode {
    return root.get('pairConversations').get(pairId(senderId, otherUserId)).get(conversationId);
  }

  // Poll helper: wait until a node's .once() callback returns a truthy value (or falsy with invert=true),
  // or until a custom `predicate` is satisfied. Under heavy parallel load the fire-and-forget checkpoint
  // chain can be delayed by the event loop, so blind setTimeout is fragile — polling guarantees we only
  // proceed once the data is actually there.
  //
  // TODO §S1 bugfix: `invert` alone can no longer express "this message was pruned" — deleteMessageRecord
  // (gun-message-store.ts) now nulls the message's own content fields instead of nulling the whole node
  // (matching the ledger's field-nulling fix for the identical class of bug: a real Gun soul is a
  // permanent graph key once created, so `.get(child).put(null)` only unlinks the *parent's* edge to it,
  // never the child's own content — confirmed against the server's raw `gun._.graph` via the
  // 30-ledger-message-pruning-e2e spec). A "pruned" node's `.once()` value is therefore still a truthy
  // object (all fields null), so callers that mean "pruned" now pass a `predicate` checking `.text`.
  async function waitForNodeValue(
    node: FakeGunNode,
    { invert = false, timeoutMs = 10_000, predicate }:
      { invert?: boolean; timeoutMs?: number; predicate?: (value: any) => boolean } = {},
  ): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      let value: any;
      node.once((data) => { value = data; });
      const ready = predicate ? predicate(value) : (invert ? !value : value);
      if (ready) return value;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Node did not reach expected state within ${timeoutMs}ms`);
  }

  it('writes a checkpoint node once MESSAGE_CHECKPOINT_INTERVAL messages have been sent', async () => {
    const { gunService, root } = makeGunService();
    const store = new GunMessageStore(gunService);
    for (let i = 0; i < MESSAGE_CHECKPOINT_INTERVAL; i += 1) {
      store.putMessageRecord(conversationId, makeWire(i, senderId), { otherUserId });
    }

    // Wait until the checkpoint actually appears — polling handles slow event loops under load.
    const checkpointNode = await waitForNodeValue(
      conversationNode(root).get('checkpoints').get(`count_${MESSAGE_CHECKPOINT_INTERVAL}`),
      {},
    );
    expect(checkpointNode).toBeTruthy();
    const content: MessageCheckpointContent = JSON.parse(checkpointNode.contentJson);
    expect(content.count).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(content.rangeStartId).toBe('msg-0000');

    const stateNode = await waitForNodeValue(
      conversationNode(root).get('checkpointState'),
      {},
    );
    expect(stateNode.lastCheckpointedCount).toBe(MESSAGE_CHECKPOINT_INTERVAL);
    expect(stateNode.prunedThroughCount).toBe(0);
  });

  it('does not write a checkpoint while a reconcile is marked in-flight for that conversation', async () => {
    const { gunService, root } = makeGunService();
    const store = new GunMessageStore(gunService);
    store.setReconcileInFlight(conversationId, true);
    for (let i = 0; i < MESSAGE_CHECKPOINT_INTERVAL; i += 1) {
      store.putMessageRecord(conversationId, makeWire(i, senderId), { otherUserId });
    }

    let checkpointNode: any;
    conversationNode(root)
      .get('checkpoints')
      .get(`count_${MESSAGE_CHECKPOINT_INTERVAL}`)
      .once((data) => {
        checkpointNode = data;
      });
    expect(checkpointNode).toBeFalsy();

    store.setReconcileInFlight(conversationId, false);
    // A subsequent send re-evaluates and finds the interval already met.
    store.putMessageRecord(conversationId, makeWire(MESSAGE_CHECKPOINT_INTERVAL, senderId), { otherUserId });

    const checkpointAfter = await waitForNodeValue(
      conversationNode(root).get('checkpoints').get(`count_${MESSAGE_CHECKPOINT_INTERVAL}`),
      {},
    );
    expect(checkpointAfter).toBeTruthy();
  });

  it('deletes messages more than MESSAGE_RETENTION_WINDOW behind the most recent checkpoint', async () => {
    const { gunService, root } = makeGunService();
    const store = new GunMessageStore(gunService);
    const messagesNode = () => conversationNode(root).get('messages');

    const totalWindows = 5; // 250 messages, 50 past the 200-message retention window
    const total = MESSAGE_CHECKPOINT_INTERVAL * totalWindows;
    for (let i = 0; i < total; i += 1) {
      store.putMessageRecord(conversationId, makeWire(i, senderId), { otherUserId });
      // maybeCreateMessageCheckpoint is fire-and-forget with only a same-tick in-flight
      // guard (see gun-message-store.ts) — firing all 250 putMessageRecord calls back to
      // back races that many overlapping checkpoint passes against each other, which
      // stalls checkpoint progression indefinitely rather than just slowing it down
      // (confirmed: polling for the final checkpoint alone never resolves, even given
      // 10s). Waiting for each window's own checkpoint to land before sending the next
      // window's messages keeps this test's write pattern one-pass-at-a-time, matching
      // how messages actually arrive in production (one at a time, not in a tight
      // synchronous loop).
      if ((i + 1) % MESSAGE_CHECKPOINT_INTERVAL === 0) {
        // eslint-disable-next-line no-await-in-loop
        await waitForNodeValue(
          conversationNode(root).get('checkpoints').get(`count_${i + 1}`),
          {},
        );
      }
    }

    // Wait for the final window's pruning pass to settle.
    await waitForNodeValue(
      conversationNode(root).get('checkpoints').get(`count_${total}`),
      {},
    );

    const deletableThrough = total - MESSAGE_RETENTION_WINDOW;

    // A pruned message's soul key stays a truthy node forever (Gun's graph is append-only —
    // see waitForNodeValue's own doc comment); "pruned" means its content fields are null.
    let firstMessage: any;
    messagesNode().get('msg-0000').once((data) => { firstMessage = data; });
    expect(firstMessage?.text).toBeFalsy();

    const lastDeletedId = `msg-${String(deletableThrough - 1).padStart(4, '0')}`;
    let lastDeleted: any;
    messagesNode().get(lastDeletedId).once((data) => { lastDeleted = data; });
    expect(lastDeleted?.text).toBeFalsy();

    const firstSurvivingId = `msg-${String(deletableThrough).padStart(4, '0')}`;
    let firstSurviving: any;
    messagesNode().get(firstSurvivingId).once((data) => { firstSurviving = data; });
    expect(firstSurviving?.text).toBe(`plaintext-${deletableThrough}`);

    let lastMessage: any;
    messagesNode().get(`msg-${String(total - 1).padStart(4, '0')}`).once((data) => { lastMessage = data; });
    expect(lastMessage?.text).toBe(`plaintext-${total - 1}`);

    let stateNode: any;
    conversationNode(root).get('checkpointState').once((data) => { stateNode = data; });
    expect(stateNode.prunedThroughCount).toBe(deletableThrough);
  });

  it('coalesces a rapid backlog and keeps checkpointing after pruning changes the local list offset', async () => {
    const { gunService, root } = makeGunService();
    const store = new GunMessageStore(gunService);
    const total = MESSAGE_RETENTION_WINDOW + MESSAGE_CHECKPOINT_INTERVAL * 2;

    for (let i = 0; i < total; i += 1) {
      store.putMessageRecord(conversationId, makeWire(i, senderId), { otherUserId });
    }

    await waitForNodeValue(
      conversationNode(root).get('checkpoints').get(`count_${total}`),
      { timeoutMs: 20_000 },
    );
    await waitForNodeValue(
      conversationNode(root).get('messages').get('msg-0000'),
      { timeoutMs: 20_000, predicate: (v) => !v?.text },
    );
    let state: any;
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      conversationNode(root).get('checkpointState').once((data) => { state = data; });
      if (state?.prunedThroughCount === total - MESSAGE_RETENTION_WINDOW) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(state.lastCheckpointedCount).toBe(total);
    expect(state.prunedThroughCount).toBe(total - MESSAGE_RETENTION_WINDOW);
  }, 30_000);
});
