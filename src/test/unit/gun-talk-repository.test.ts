import { GunTalkRepository } from '../../web/services/gun-talk-repository';
import type { Talk } from '../../shared/types';

const talk: Talk = { id: 'talk-cid', title: 'Hello', authorId: 'alice', type: 'tag', isAdult: false, language: 'en', tags: [], questions: [], createdAt: new Date('2026-08-12T00:00:00Z'), isTemplate: false, usageCount: 0 };

describe('GunTalkRepository', () => {
  test('commits and rereads authored and received Talks', async () => {
    const graph = new Map<string, unknown>();
    const repo = new GunTalkRepository({ put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
    await repo.putAuthored('alice-sea', talk);
    await repo.putReceived('bob-sea', 'alice-sea', talk);
    await expect(repo.getAuthored('alice-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    await expect(repo.getReceived('bob-sea', 'alice-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    await expect(repo.getReceivedById('bob-sea', talk.id)).resolves.toMatchObject({ id: talk.id });
    expect([...graph.keys()]).toEqual([
      'users/alice-sea/talks/talk-cid',
      'users/bob-sea/receivedTalks/alice-sea/talk-cid',
      'users/bob-sea/receivedTalkIndex/talk-cid',
    ]);
  });

  test('does not fail receipt when Gun read-back is inconclusive — the put already committed locally', async () => {
    // A relay-only hub can leave get() unable to confirm a write it just accepted (no local
    // persistence to answer from). The write itself already succeeded, so this must not throw.
    const repo = new GunTalkRepository({ put: async () => undefined, get: async () => null });
    await expect(repo.putReceived('bob', 'alice', talk)).resolves.toBeUndefined();
  });

  test('retries a transient authored commit failure without changing the content-addressed soul', async () => {
    const graph = new Map<string, unknown>();
    let putAttempts = 0;
    const repo = new GunTalkRepository({
      put: async (key, value) => {
        putAttempts += 1;
        if (putAttempts === 1) throw new Error('transient ack timeout');
        graph.set(key, value);
      },
      get: async (key) => graph.get(key) ?? null,
    });

    await expect(repo.putAuthored('alice-sea', talk)).resolves.toBeUndefined();
    expect(putAttempts).toBe(2);
    expect([...graph.keys()]).toEqual(['users/alice-sea/talks/talk-cid']);
  });

  test('duplicate multi-path commits converge to one soul', async () => {
    const graph = new Map<string, unknown>();
    const repo = new GunTalkRepository({ put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
    await Promise.all([repo.putReceived('bob', 'alice', talk), repo.putReceived('bob', 'alice', talk)]);
    expect([...graph.keys()].filter((key) => key.includes('/receivedTalks/'))).toHaveLength(1);
    await expect(repo.getReceived('bob', 'alice', talk.id)).resolves.toMatchObject({ id: talk.id });
  });

  test('rebuilds received history from Gun after compatibility caches are deleted', async () => {
    const graph = new Map<string, unknown>();
    const first = new GunTalkRepository({ put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
    await first.putReceived('bob', 'alice', talk);
    const restarted = new GunTalkRepository({ put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
    await expect(restarted.getReceivedById('bob', talk.id)).resolves.toMatchObject({ id: talk.id, title: talk.title });
  });

  test('restarts sender before delivery and rereads authored Talk from Gun', async () => {
    const graph = new Map<string, unknown>();
    const store = { put: async (key: string, value: unknown) => { graph.set(key, value); }, get: async (key: string) => graph.get(key) ?? null };
    await new GunTalkRepository(store).putAuthored('alice', talk);
    await expect(new GunTalkRepository(store).getAuthored('alice', talk.id)).resolves.toMatchObject({ id: talk.id, title: talk.title });
  });
});
