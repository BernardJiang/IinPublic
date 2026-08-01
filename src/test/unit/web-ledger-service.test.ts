/**
 * TODO §S Items 1+2: unit coverage for WebLedgerService's checkpoint creation and
 * pruning (docs/design/section-s-merkle-checkpoint-pruning-design-note.md). Uses a
 * minimal in-memory fake for WebGunService (just get/put/subscribe/getStoredPair, the
 * only methods WebLedgerService calls) rather than a real Gun instance — real SEA
 * crypto runs fine under Jest's node environment (Gun/SEA works in both browser and
 * Node), so signatures are genuinely signed and verified, not stubbed.
 */
import Gun from 'gun';
import 'gun/sea';
import {
  WebLedgerService,
  LEDGER_CHECKPOINT_INTERVAL,
  LEDGER_RETENTION_WINDOW,
} from '../../web/services/web-ledger-service';
import { InteractionKind, type CheckpointCreatedContent } from '../../shared/types';
import { computeMerkleRoot } from '../../shared/merkle-checkpoint';
import type { WebGunService } from '../../web/services/web-gun-service';
import type { GunPair } from '../../web/services/gun-bridge';

const SEA = (Gun as any).SEA;

class FakeGunStore {
  private data = new Map<string, any>();
  constructor(private pair: GunPair) {}
  async put(key: string, value: any): Promise<void> {
    this.data.set(key, value);
  }
  async get(key: string): Promise<any> {
    return this.data.get(key) ?? null;
  }
  subscribe(_key: string, _callback: (data: any) => void): () => void {
    return () => {};
  }
  getStoredPair(): GunPair | null {
    return this.pair;
  }
}

describe('WebLedgerService checkpoint creation (TODO §S Item 1)', () => {
  let pair: GunPair;
  let store: FakeGunStore;
  let userId: string;

  beforeAll(async () => {
    pair = await SEA.pair();
  });

  beforeEach(() => {
    store = new FakeGunStore(pair);
    userId = 'ledger-test-user';
  });

  function makeService(): WebLedgerService {
    return new WebLedgerService(store as unknown as WebGunService, userId, pair.pub);
  }

  it('writes no checkpoint before the interval is reached', async () => {
    const service = makeService();
    for (let i = 0; i < LEDGER_CHECKPOINT_INTERVAL - 1; i += 1) {
      await service.appendEvent(InteractionKind.TALK_CREATED, {
        talkId: `talk-${i}`, title: `T${i}`, type: 'flow', language: 'en',
      });
    }
    // No checkpoint event should exist at seq 100 (the interval) or seq 100's checkpoint index.
    const checkpointIndex = await store.get(`ledger/${userId}/checkpoints/seq_${LEDGER_CHECKPOINT_INTERVAL}`);
    expect(checkpointIndex).toBeNull();
  });

  it('writes a signed, verifiable checkpoint exactly at the interval', async () => {
    const service = makeService();
    for (let i = 0; i < LEDGER_CHECKPOINT_INTERVAL; i += 1) {
      await service.appendEvent(InteractionKind.TALK_CREATED, {
        talkId: `talk-${i}`, title: `T${i}`, type: 'flow', language: 'en',
      });
    }

    // The checkpoint event lands at seq 101 (the next seq after the 100-event window).
    const checkpointEventRaw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL + 1}`);
    expect(checkpointEventRaw).toBeTruthy();
    expect(checkpointEventRaw.kind).toBe(InteractionKind.CHECKPOINT_CREATED);

    const content: CheckpointCreatedContent = JSON.parse(checkpointEventRaw.contentJson);
    expect(content.rangeStart).toBe(1);
    expect(content.rangeEnd).toBe(LEDGER_CHECKPOINT_INTERVAL);
    expect(content.count).toBe(LEDGER_CHECKPOINT_INTERVAL);
    expect(content.leafIds).toHaveLength(LEDGER_CHECKPOINT_INTERVAL);

    // The stored merkleRoot must match recomputing it fresh from the retained leafIds —
    // proves the checkpoint is self-consistent, not just present.
    const recomputed = await computeMerkleRoot(content.leafIds);
    expect(content.merkleRoot).toBe(recomputed);

    // Reuse the service's own verifyEvent (production code, not a re-implementation) to
    // confirm the checkpoint event's signature is genuinely valid.
    const checkpointEvent = {
      id: checkpointEventRaw.id,
      seq: checkpointEventRaw.seq,
      prev: checkpointEventRaw.prev,
      kind: checkpointEventRaw.kind,
      pubkey: checkpointEventRaw.pubkey,
      timestamp: checkpointEventRaw.timestamp,
      content,
      sig: checkpointEventRaw.sig,
    };
    await expect(service.verifyEvent(checkpointEvent)).resolves.toBe(true);

    // The fast-lookup index (SRS §9.3 step 1) points at the event holding the content.
    const checkpointIndex = await store.get(`ledger/${userId}/checkpoints/seq_${LEDGER_CHECKPOINT_INTERVAL}`);
    expect(checkpointIndex).toEqual({
      eventSeq: LEDGER_CHECKPOINT_INTERVAL + 1,
      rangeStart: 1,
      rangeEnd: LEDGER_CHECKPOINT_INTERVAL,
    });

    // The head node carries the new checkpoint watermark for a future reload to find.
    const head = await store.get(`ledger/${userId}/head`);
    expect(head.lastCheckpointSeq).toBe(LEDGER_CHECKPOINT_INTERVAL);
  });

  it('rejects a tampered checkpoint event via the normal signature check', async () => {
    const service = makeService();
    for (let i = 0; i < LEDGER_CHECKPOINT_INTERVAL; i += 1) {
      await service.appendEvent(InteractionKind.TALK_CREATED, {
        talkId: `talk-${i}`, title: `T${i}`, type: 'flow', language: 'en',
      });
    }
    const raw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL + 1}`);
    const tamperedContent: CheckpointCreatedContent = {
      ...JSON.parse(raw.contentJson),
      merkleRoot: 'tampered-root-value',
    };
    const tamperedEvent = {
      id: raw.id, seq: raw.seq, prev: raw.prev, kind: raw.kind, pubkey: raw.pubkey,
      timestamp: raw.timestamp, content: tamperedContent, sig: raw.sig,
    };
    await expect(service.verifyEvent(tamperedEvent)).resolves.toBe(false);
  });

  it('rebuilds the pending window across a simulated reload, so the interval-th event after reload still checkpoints correctly', async () => {
    const firstSession = makeService();
    // Stop one event short of the interval — no checkpoint has fired yet, but the
    // in-memory pendingWindowIds (99 ids) is about to be lost when this "session" ends.
    for (let i = 0; i < LEDGER_CHECKPOINT_INTERVAL - 1; i += 1) {
      await firstSession.appendEvent(InteractionKind.TALK_CREATED, {
        talkId: `talk-${i}`, title: `T${i}`, type: 'flow', language: 'en',
      });
    }

    // New service instance over the same store — simulates a page reload. If the pending
    // window isn't correctly rebuilt from Gun, the very next append would start counting
    // from 0 instead of 99, and no checkpoint would fire here.
    const secondSession = makeService();
    await secondSession.loadOwnFeedHead();
    await secondSession.appendEvent(InteractionKind.TALK_CREATED, {
      talkId: 'talk-final', title: 'Final', type: 'flow', language: 'en',
    });

    const checkpointRaw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL + 1}`);
    expect(checkpointRaw).toBeTruthy();
    expect(checkpointRaw.kind).toBe(InteractionKind.CHECKPOINT_CREATED);
    const content: CheckpointCreatedContent = JSON.parse(checkpointRaw.contentJson);
    expect(content.rangeStart).toBe(1);
    expect(content.rangeEnd).toBe(LEDGER_CHECKPOINT_INTERVAL);
    expect(content.count).toBe(LEDGER_CHECKPOINT_INTERVAL);
    // The 99 ids from session 1 plus the 1 from session 2 — proves the rebuild actually
    // recovered the real ids, not just a count.
    expect(new Set(content.leafIds).size).toBe(LEDGER_CHECKPOINT_INTERVAL);
  });

  describe('pruning (TODO §S Item 2)', () => {
    async function appendN(service: WebLedgerService, count: number, label: string): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        await service.appendEvent(InteractionKind.TALK_CREATED, {
          talkId: `${label}-${i}`, title: `${label}${i}`, type: 'flow', language: 'en',
        });
      }
    }

    it('prunes nothing before the retention window is exceeded', async () => {
      const service = makeService();
      // 3 checkpoints' worth (300 events) — well under LEDGER_RETENTION_WINDOW (500), so
      // nothing should be deletable yet even though checkpoints exist.
      await appendN(service, LEDGER_CHECKPOINT_INTERVAL * 3, 'talk');

      const firstEventRaw = await store.get(`ledger/${userId}/events/1`);
      expect(firstEventRaw).toBeTruthy();
      const firstCheckpointRaw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL + 1}`);
      expect(firstCheckpointRaw).toBeTruthy();
    }, 20_000);

    it('deletes only events more than LEDGER_RETENTION_WINDOW behind the head, and only once checkpointed', async () => {
      const service = makeService();
      // Checkpoint k lands at seq LEDGER_CHECKPOINT_INTERVAL * k + 1 (the window's last
      // plain event is at LEDGER_CHECKPOINT_INTERVAL * k, the checkpoint takes the next seq).
      const checkpointSeq = (k: number) => LEDGER_CHECKPOINT_INTERVAL * k + 1;

      // First window: capture checkpoint #1's id before it's eventually pruned by a
      // later checkpoint's prune pass.
      await appendN(service, LEDGER_CHECKPOINT_INTERVAL, 'talk');
      const checkpoint1Raw = await store.get(`ledger/${userId}/events/${checkpointSeq(1)}`);
      const checkpoint1Id: string = checkpoint1Raw.id;

      // 5 more windows (6 checkpoints total) crosses the retention window: head lands at
      // seq 606, and min(lastCheckpointSeq=600, 606 - 500) = 106 becomes deletable —
      // covering the whole first window (seqs 1-100) plus checkpoint #1 itself (seq 101,
      // an ordinary chain event once checkpoint #2 covers it).
      await appendN(service, LEDGER_CHECKPOINT_INTERVAL * 5, 'talk');

      const prunedEventRaw = await store.get(`ledger/${userId}/events/1`);
      expect(prunedEventRaw).toBeNull();
      const stillPrunedRaw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL}`);
      expect(stillPrunedRaw).toBeNull();

      // Checkpoint #1 itself (seq 101) is an ordinary chain event, covered by checkpoint
      // #2's range (101-200, since checkpoint #1's own id counts toward the next
      // window) — so it is *also* deletable once it falls behind the retention window,
      // same as any other event. It must be gone here, not specially preserved.
      const checkpoint1AfterPruneRaw = await store.get(`ledger/${userId}/events/${checkpointSeq(1)}`);
      expect(checkpoint1AfterPruneRaw).toBeNull();

      // Checkpoint #2 (seq 201, covering 101-200) is recent enough to survive, and its
      // retained leafIds include checkpoint #1's own event id — proving checkpoint #1's
      // existence remains provable even after checkpoint #1's own raw node is pruned
      // (Item 3's dependency on this chain-of-custody property).
      const checkpoint2Raw = await store.get(`ledger/${userId}/events/${checkpointSeq(2)}`);
      expect(checkpoint2Raw).toBeTruthy();
      expect(checkpoint2Raw.kind).toBe(InteractionKind.CHECKPOINT_CREATED);
      const checkpoint2Content: CheckpointCreatedContent = JSON.parse(checkpoint2Raw.contentJson);
      expect(checkpoint2Content.leafIds).toHaveLength(LEDGER_CHECKPOINT_INTERVAL);
      expect(checkpoint2Content.leafIds).toContain(checkpoint1Id);

      // Recent events (within the retention window of the current head) must survive.
      const recentEventRaw = await store.get(`ledger/${userId}/events/${LEDGER_CHECKPOINT_INTERVAL * 6}`);
      expect(recentEventRaw).toBeTruthy();

      // Precise boundary: pruning only re-evaluates each time a *new* checkpoint fires,
      // using the head at that exact moment — not continuously as later plain events
      // accumulate. Checkpoint #6 itself lands at seq 601 (checkpointSeq(6)), so its own
      // prune pass computes min(lastCheckpointSeq=600, 601 - LEDGER_RETENTION_WINDOW) =
      // min(600, 101) = 101. No further checkpoint fires afterward in this test (only 5
      // more plain events follow, short of a 7th window), so 101 is the final boundary —
      // deliberately less than "seq 606 minus the window" would naively suggest.
      const deletableThrough = Math.min(
        LEDGER_CHECKPOINT_INTERVAL * 6,
        checkpointSeq(6) - LEDGER_RETENTION_WINDOW,
      );
      const lastDeletedRaw = await store.get(`ledger/${userId}/events/${deletableThrough}`);
      expect(lastDeletedRaw).toBeNull();
      const firstSurvivingRaw = await store.get(`ledger/${userId}/events/${deletableThrough + 1}`);
      expect(firstSurvivingRaw).toBeTruthy();
    }, 20_000);

    it('persists the pruned watermark so a reload does not need to re-derive it', async () => {
      const service = makeService();
      await appendN(service, LEDGER_CHECKPOINT_INTERVAL * 6, 'talk');

      const head = await store.get(`ledger/${userId}/head`);
      expect(head.prunedThroughSeq).toBeGreaterThan(0);

      // A fresh instance over the same store picks up the watermark without re-scanning.
      const reloaded = makeService();
      await reloaded.loadOwnFeedHead();
      // Appending one more event should not error or attempt to re-delete the same range —
      // if it did throw, this await would reject and fail the test.
      await reloaded.appendEvent(InteractionKind.TALK_CREATED, {
        talkId: 'after-reload', title: 'After reload', type: 'flow', language: 'en',
      });
    }, 20_000);
  });
});
