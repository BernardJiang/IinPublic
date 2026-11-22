import {
  LocalPrivateConversationMetadataRepository,
} from '../../web/services/local-private-conversation-metadata-repository';
import type { WebGunService } from '../../web/services/web-gun-service';

function harness() {
  const values = new Map<string, any>();
  const listeners = new Map<string, Set<(value: any) => void>>();
  const putPrivate = jest.fn(async (key: string, value: any) => {
    values.set(key, value);
    for (const listener of listeners.get(key) || []) listener(value);
  });
  const getPrivate = jest.fn(async (key: string) => values.get(key) ?? null);
  const subscribePrivate = jest.fn((key: string, callback: (value: any) => void) => {
    const bucket = listeners.get(key) || new Set();
    bucket.add(callback);
    listeners.set(key, bucket);
    return () => bucket.delete(callback);
  });
  const getGun = jest.fn(() => { throw new Error('public Gun must not be used'); });
  const gun = { putPrivate, getPrivate, subscribePrivate, getGun } as unknown as WebGunService;
  return { values, putPrivate, getPrivate, subscribePrivate, getGun, gun };
}

describe('LocalPrivateConversationMetadataRepository', () => {
  test('merges metadata in owner-private Gun without touching the public graph', async () => {
    const h = harness();
    const repo = new LocalPrivateConversationMetadataRepository(h.gun);
    const snapshots: string[][] = [];
    const off = repo.subscribe('alice', (records) => snapshots.push(records.map((r) => r.conversationId)));

    await repo.upsert('alice', { conversationId: 'c1', otherUserId: 'bob', talkId: 't1' });
    await repo.upsert('alice', { conversationId: 'c1', otherUserId: 'bob', dealEligible: true });

    await expect(repo.get('alice', 'c1')).resolves.toMatchObject({
      conversationId: 'c1', otherUserId: 'bob', talkId: 't1', dealEligible: true,
    });
    expect(snapshots.at(-1)).toEqual(['c1']);
    expect(h.getGun).not.toHaveBeenCalled();
    off();
  });

  // Five-phone starter tags (2026-11-21): each match rewrote the whole encrypted envelope.
  test('updates made during a write share one write; an unchanged record writes nothing', async () => {
    const h = harness();
    const repo = new LocalPrivateConversationMetadataRepository(h.gun);
    await repo.upsert('alice', { conversationId: 'c0', otherUserId: 'zed' });
    expect(h.putPrivate).toHaveBeenCalledTimes(1);
    const writes = [
      repo.upsert('alice', { conversationId: 'c1', otherUserId: 'bob' }),
      repo.upsert('alice', { conversationId: 'c2', otherUserId: 'cy' }),
      repo.upsert('alice', { conversationId: 'c3', otherUserId: 'dee' }),
    ];
    await Promise.all(writes);
    expect(h.putPrivate).toHaveBeenCalledTimes(2); // the three made together share one write
    const ids = Object.keys(JSON.parse(h.values.get([...h.values.keys()][0]).recordsJson)).sort();
    expect(ids).toEqual(['c0', 'c1', 'c2', 'c3']);
    const before = h.putPrivate.mock.calls.length;
    await repo.upsert('alice', { conversationId: 'c1', otherUserId: 'bob' });
    expect(h.putPrivate).toHaveBeenCalledTimes(before);
  });
});
