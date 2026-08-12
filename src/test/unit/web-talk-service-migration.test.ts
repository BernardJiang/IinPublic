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
});
