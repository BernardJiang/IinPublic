import {
  LocalPrivateConversationRepository,
  type LocalConversationWire,
} from '../../web/services/local-private-conversation-repository';
import type { WebGunService } from '../../web/services/web-gun-service';

function wire(id: string, at: number): LocalConversationWire {
  return {
    id,
    senderId: 'alice',
    text: `ciphertext-${id}`,
    timestamp: new Date(at).toISOString(),
    channel: 'pair',
    transport: 'direct-p2p',
    encryption: 'sea-ecdh-v1',
  };
}

function harness() {
  const values = new Map<string, any>();
  const listeners = new Map<string, Set<(value: any) => void>>();
  const put = jest.fn(async (key: string, value: any) => {
    values.set(key, value);
    for (const listener of listeners.get(key) || []) listener(value);
  });
  const get = jest.fn(async (key: string) => values.get(key) ?? null);
  const subscribe = jest.fn((key: string, callback: (value: any) => void) => {
    const bucket = listeners.get(key) || new Set();
    bucket.add(callback);
    listeners.set(key, bucket);
    return () => bucket.delete(callback);
  });
  const publicGun = jest.fn(() => {
    throw new Error('public Gun must not be used');
  });
  const gun = {
    putPrivate: put,
    getPrivate: get,
    subscribePrivate: subscribe,
    getGun: publicGun,
  } as unknown as WebGunService;
  return { values, put, get, subscribe, publicGun, gun };
}

describe('LocalPrivateConversationRepository', () => {
  test('stores and subscribes through private Gun without touching the public graph', async () => {
    const h = harness();
    const repo = new LocalPrivateConversationRepository(h.gun, 2, 4, 2);
    const snapshots: string[][] = [];
    const off = repo.subscribe('conv-1', (rows) => snapshots.push(rows.map((row) => row.id)));

    await repo.append('conv-1', wire('m2', 2));
    await repo.append('conv-1', wire('m1', 1));
    await new Promise((resolve) => setImmediate(resolve));

    await expect(repo.list('conv-1')).resolves.toEqual([wire('m1', 1), wire('m2', 2)]);
    expect(snapshots.at(-1)).toEqual(['m1', 'm2']);
    expect(h.publicGun).not.toHaveBeenCalled();
    off();
  });

  test('is idempotent, checkpoints encrypted wires, and prunes only checkpointed history', async () => {
    const h = harness();
    const repo = new LocalPrivateConversationRepository(h.gun, 2, 3, 2);
    for (let i = 1; i <= 6; i += 1) await repo.append('conv-2', wire(`m${i}`, i));
    await repo.append('conv-2', wire('m6', 6));

    expect((await repo.list('conv-2')).map((row) => row.id)).toEqual(['m4', 'm5', 'm6']);
    const manifest = h.values.get('conversations/conv-2/history');
    expect(manifest.version).toBe(2);
    expect(manifest.totalCount).toBe(6);
    expect(manifest.lastCheckpointedCount).toBe(6);
    expect(manifest.prunedThroughCount).toBe(3);
    expect(JSON.parse(manifest.checkpointsJson)).toEqual(expect.arrayContaining([
      expect.objectContaining({ rangeStartId: 'm5', rangeEndId: 'm6', count: 2 }),
    ]));
  });

  test('ordinary appends rewrite one bounded segment plus the small manifest', async () => {
    const h = harness();
    const repo = new LocalPrivateConversationRepository(h.gun, 50, 200, 2);
    for (let i = 1; i <= 5; i += 1) await repo.append('conv-3', wire(`m${i}`, i));
    h.put.mockClear();

    await repo.append('conv-3', wire('m6', 6));

    expect(h.put.mock.calls.map(([key]) => key)).toEqual([
      'conversationHistorySegments/conv-3/2',
      'conversations/conv-3/history',
    ]);
    const segment = h.values.get('conversationHistorySegments/conv-3/2');
    expect(JSON.parse(segment.messagesJson).map((row: LocalConversationWire) => row.id)).toEqual(['m5', 'm6']);
  });

  test('migrates a legacy whole-history envelope lazily on the next append', async () => {
    const h = harness();
    h.values.set('conversations/conv-legacy/history', {
      version: 1,
      conversationId: 'conv-legacy',
      messagesJson: JSON.stringify([wire('m1', 1), wire('m2', 2)]),
      checkpointsJson: '[]',
      totalCount: 2,
      lastCheckpointedCount: 0,
      prunedThroughCount: 0,
      updatedAt: new Date(2).toISOString(),
    });
    const repo = new LocalPrivateConversationRepository(h.gun, 50, 200, 2);

    await repo.append('conv-legacy', wire('m3', 3));

    const reloaded = new LocalPrivateConversationRepository(h.gun, 50, 200, 2);
    expect((await reloaded.list('conv-legacy')).map((row) => row.id)).toEqual(['m1', 'm2', 'm3']);
    expect(h.values.get('conversations/conv-legacy/history')).toMatchObject({
      version: 2,
      segmentCount: 2,
      totalCount: 3,
    });
  });
});
