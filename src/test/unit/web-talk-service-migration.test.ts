import { WebTalkService } from '../../web/services/web-talk-service';
import type { WebGunService } from '../../web/services/web-gun-service';

function service(graph: Map<string, unknown>, repository: boolean): WebTalkService {
  const gun = {
    getStoredPair: () => ({ pub: 'alice-sea', epub: 'alice-epub' }),
    put: async (key: string, value: unknown) => { graph.set(key, value); },
    get: async (key: string) => graph.get(key) ?? null,
  } as unknown as WebGunService;
  return new WebTalkService(gun, undefined, { gunTalkRepository: repository });
}

describe('WebTalkService Gun migration and rollback', () => {
  beforeEach(() => localStorage.clear());

  test('migrates a legacy authored Talk idempotently and rollback still reads it', async () => {
    const graph = new Map<string, unknown>();
    const legacy = service(graph, false);
    const talk = await legacy.createTalk({ id: 'legacy-talk', authorId: 'alice', title: 'Legacy', type: 'tag' });
    expect(graph.size).toBe(0);

    const migrating = service(graph, true);
    await expect(migrating.getTalk(talk.id)).resolves.toMatchObject({ id: talk.id });
    const sizeAfterFirstMigration = graph.size;
    await expect(migrating.getTalk(talk.id)).resolves.toMatchObject({ id: talk.id });
    expect(graph.size).toBe(sizeAfterFirstMigration);

    graph.clear();
    const rollback = service(graph, false);
    await expect(rollback.getTalk(talk.id)).resolves.toMatchObject({ id: talk.id, title: 'Legacy' });
  });

  test('does not expose a broadcastable compatibility row when the authoritative create fails', async () => {
    const gun = {
      getStoredPair: () => ({ pub: 'alice-sea', epub: 'alice-epub' }),
      put: async () => { throw new Error('repository unavailable'); },
      get: async () => null,
    } as unknown as WebGunService;
    const svc = new WebTalkService(gun, undefined, { gunTalkRepository: true });

    await expect(svc.createTalk({
      id: 'failed-talk',
      authorId: 'alice',
      title: 'Must not become an OUT row',
      type: 'tag',
    })).rejects.toThrow('repository unavailable');

    expect(localStorage.getItem('myTalks')).toBeNull();
    expect(localStorage.getItem('myAuthoredTalks')).toBeNull();
  });
});
