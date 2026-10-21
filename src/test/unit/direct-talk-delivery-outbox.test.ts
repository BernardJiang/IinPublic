import { DIRECT_TALK_OUTBOX_MAX_ENTRIES, DIRECT_TALK_OUTBOX_TTL_MS, DirectTalkDeliveryOutbox } from '../../web/services/direct-talk-delivery-outbox';
import type { P2PMeshTalkBodyPayload } from '../../shared/p2p-mesh-protocol';
import type { WebGunService } from '../../web/services/web-gun-service';

function memoryGun(): WebGunService {
  const values = new Map<string, unknown>();
  return {
    getPrivate: async (key: string) => values.get(key) ?? null,
    putPrivate: async (key: string, value: unknown) => { values.set(key, value); },
  } as unknown as WebGunService;
}

function payload(talkId: string, hash: string): P2PMeshTalkBodyPayload {
  return {
    roomId: 'nearby:test',
    broadcastAt: '2026-10-09T12:00:00.000Z',
    talkId,
    authorId: 'alice',
    authorName: 'Alice',
    title: 'Coffee?',
    type: 'tag',
    questionCount: 1,
    contentHash: hash,
    talkData: { id: talkId, authorId: 'alice', title: 'Coffee?', questions: [] },
  };
}

describe('DirectTalkDeliveryOutbox', () => {
  it('durably deduplicates one revision per receiver and clears only an end-recipient ACK', async () => {
    const gun = memoryGun();
    const outbox = new DirectTalkDeliveryOutbox(gun);
    const first = await outbox.enqueue('nearby:test', 'bob', payload('talk-1', 'hash-1'));
    await outbox.enqueue('nearby:test', 'bob', payload('talk-1', 'hash-1'));
    await outbox.enqueue('nearby:test', 'carol', payload('talk-1', 'hash-1'));
    expect(await outbox.list()).toHaveLength(2);

    await outbox.markAttempt(first.key);
    expect((await outbox.list()).find((entry) => entry.key === first.key)?.attemptCount).toBe(1);

    const removed = await outbox.acknowledge({
      roomId: 'nearby:test',
      recipientUserId: 'bob',
      talkId: 'talk-1',
      contentHash: 'hash-1',
    });
    expect(removed.map((entry) => entry.recipientUserId)).toEqual(['bob']);
    expect((await outbox.list()).map((entry) => entry.recipientUserId)).toEqual(['carol']);
  });

  it('keeps edited revisions independent', async () => {
    const outbox = new DirectTalkDeliveryOutbox(memoryGun());
    await outbox.enqueue('nearby:test', 'bob', payload('talk-1', 'hash-1'));
    await outbox.enqueue('nearby:test', 'bob', payload('talk-1', 'hash-2'));
    expect((await outbox.list()).map((entry) => entry.contentHash)).toEqual(['hash-1', 'hash-2']);
  });

  it('expires entries for receivers who never come back and stays bounded', async () => {
    const gun = memoryGun();
    let now = Date.parse('2026-10-01T00:00:00.000Z');
    const outbox = new DirectTalkDeliveryOutbox(gun, () => now);
    await outbox.enqueue('nearby:test', 'gone', payload('talk-old', 'hash-old'));
    now += DIRECT_TALK_OUTBOX_TTL_MS - 1;
    await outbox.enqueue('nearby:test', 'bob', payload('talk-new', 'hash-new'));
    expect((await outbox.list()).map((entry) => entry.recipientUserId).sort()).toEqual(['bob', 'gone']);
    now += 2;
    expect((await outbox.list()).map((entry) => entry.recipientUserId)).toEqual(['bob']);
  });

  it('drops the oldest entries past the hard size bound', async () => {
    const values = new Map<string, unknown>();
    const gun = {
      getPrivate: async (key: string) => values.get(key) ?? null,
      putPrivate: async (key: string, value: unknown) => { values.set(key, value); },
    } as unknown as WebGunService;
    const base = Date.parse('2026-10-01T00:00:00.000Z');
    const seeded = Array.from({ length: DIRECT_TALK_OUTBOX_MAX_ENTRIES + 3 }, (_, index) => ({
      version: 1, key: `k${index}`, roomId: 'nearby:test', recipientUserId: `u${index}`, talkId: 't', contentHash: 'h',
      payload: payload('t', 'h'), createdAt: new Date(base + index).toISOString(), updatedAt: new Date(base + index).toISOString(), attemptCount: 0,
    }));
    values.set('directTalkDeliveryOutbox', { version: 1, entriesJson: JSON.stringify(seeded), updatedAt: new Date(base).toISOString() });
    const outbox = new DirectTalkDeliveryOutbox(gun, () => base + 10_000);
    const entries = await outbox.list();
    expect(entries).toHaveLength(DIRECT_TALK_OUTBOX_MAX_ENTRIES);
    expect(entries[0]!.key).toBe('k3');
  });
});
