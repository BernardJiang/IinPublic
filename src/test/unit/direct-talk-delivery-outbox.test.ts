import { DirectTalkDeliveryOutbox } from '../../web/services/direct-talk-delivery-outbox';
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
});

