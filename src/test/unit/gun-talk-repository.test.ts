import { GunTalkRepository } from '../../web/services/gun-talk-repository';
import type { Talk } from '../../shared/types';

const talk: Talk = { id: 'talk-cid', title: 'Hello', authorId: 'alice', type: 'tag', isAdult: false, language: 'en', tags: [], questions: [], createdAt: new Date('2026-08-12T00:00:00Z'), isTemplate: false, usageCount: 0 };

function memoryPrivateStore() {
  const privateGraph = new Map<string, unknown>();
  const publicGraph = new Map<string, unknown>();
  return {
    privateGraph,
    publicGraph,
    store: {
      putPrivate: async (key: string, value: unknown) => { privateGraph.set(key, value); },
      getPrivate: async (key: string) => privateGraph.get(key) ?? null,
      put: async (key: string, value: unknown) => { publicGraph.set(key, value); },
      get: async (key: string) => publicGraph.get(key) ?? null,
    },
  };
}

describe('GunTalkRepository', () => {
  test('commits and rereads authored and received Talks', async () => {
    const { privateGraph, publicGraph, store } = memoryPrivateStore();
    const repo = new GunTalkRepository(store);
    await repo.putAuthored('alice-sea', talk);
    await repo.putReceived('bob-sea', 'alice-sea', talk);
    await expect(repo.getAuthored('alice-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    await expect(repo.getReceived('bob-sea', 'alice-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    await expect(repo.getReceivedById('bob-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    expect([...privateGraph.keys()]).toEqual([
      'talks/talk-cid',
      'receivedTalks/alice-sea/talk-cid',
      'receivedTalkIndex',
    ]);
    expect(publicGraph.size).toBe(0);
  });

  test('does not fail receipt when Gun read-back is inconclusive — the put already committed locally', async () => {
    // A relay-only hub can leave get() unable to confirm a write it just accepted (no local
    // persistence to answer from). The write itself already succeeded, so this must not throw.
    const repo = new GunTalkRepository({ putPrivate: async () => undefined, getPrivate: async () => null });
    await expect(repo.putReceived('bob', 'alice', talk)).resolves.toBeUndefined();
  });

  test('retries a transient authored commit failure without changing the content-addressed soul', async () => {
    const privateGraph = new Map<string, unknown>();
    let putAttempts = 0;
    const repo = new GunTalkRepository({
      putPrivate: async (key, value) => {
        putAttempts += 1;
        if (putAttempts === 1) throw new Error('transient ack timeout');
        privateGraph.set(key, value);
      },
      getPrivate: async (key) => privateGraph.get(key) ?? null,
    });

    await expect(repo.putAuthored('alice-sea', talk)).resolves.toBeUndefined();
    expect(putAttempts).toBe(2);
    expect([...privateGraph.keys()]).toEqual(['talks/talk-cid']);
  });

  test('duplicate multi-path commits converge to one soul', async () => {
    const { privateGraph, store } = memoryPrivateStore();
    const repo = new GunTalkRepository(store);
    await Promise.all([repo.putReceived('bob', 'alice', talk), repo.putReceived('bob', 'alice', talk)]);
    expect([...privateGraph.keys()].filter((key) => key.includes('receivedTalks/'))).toHaveLength(1);
    await expect(repo.getReceived('bob', 'alice', talk.id)).resolves.toMatchObject({ id: talk.id });
  });

  test('rebuilds received history from Gun after compatibility caches are deleted', async () => {
    const { store } = memoryPrivateStore();
    const first = new GunTalkRepository(store);
    await first.putReceived('bob', 'alice', talk);
    const restarted = new GunTalkRepository(store);
    await expect(restarted.getReceivedById('bob', talk.id)).resolves.toMatchObject({ id: talk.id, title: talk.title });
  });

  test('restarts sender before delivery and rereads authored Talk from Gun', async () => {
    const { store } = memoryPrivateStore();
    await new GunTalkRepository(store).putAuthored('alice', talk);
    await expect(new GunTalkRepository(store).getAuthored('alice', talk.id)).resolves.toMatchObject({ id: talk.id, title: talk.title });
  });
});
