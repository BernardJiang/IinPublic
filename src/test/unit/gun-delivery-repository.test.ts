import { GunDeliveryRepository } from '../../web/services/gun-delivery-repository';
import type { P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';

const response: P2PMeshTalkResponsePayload = {
  responseId: 'response-cid', talkId: 'talk-cid', authorId: 'alice', responderId: 'bob',
  submittedAt: '2026-08-12T00:00:00.000Z', respondedAt: '2026-08-12T00:00:00.000Z', version: 1,
  encryption: 'sea-ecdh-v1', payloadCiphertext: 'SEA{ciphertext}', transportMode: 'mesh-p2p',
};

describe('GunDeliveryRepository', () => {
  test('persists pair response before send and recovers committed state after restart', async () => {
    const graph = new Map<string, unknown>();
    const store = { put: async (key: string, value: unknown) => { graph.set(key, value); }, get: async (key: string) => graph.get(key) ?? null };
    const beforeCrash = new GunDeliveryRepository(store);
    await beforeCrash.putPairResponse('bob-sea', response);
    await beforeCrash.recordDelivery({ objectId: response.responseId, recipientId: 'alice', objectKind: 'talk-response', state: 'committed' });
    const afterRestart = new GunDeliveryRepository(store);
    await expect(afterRestart.getDelivery(response.responseId, 'alice')).resolves.toMatchObject({ state: 'committed', objectId: response.responseId });
    const pairResponseSoul = [...graph.keys()].find((key) => key.includes('/talkResponses/talk-cid/response-cid'));
    expect(pairResponseSoul).toBeTruthy();
    expect(pairResponseSoul).toMatch(/^pairs\/baguqeera/);
    expect(pairResponseSoul).not.toContain('~');
  });

  test('bounds pair-response souls below filesystem filename limits', async () => {
    const graph = new Map<string, unknown>();
    const store = { put: async (key: string, value: unknown) => { graph.set(key, value); }, get: async (key: string) => graph.get(key) ?? null };
    const repo = new GunDeliveryRepository(store);
    const longResponse = {
      ...response,
      talkId: `baguqeera${'t'.repeat(52)}`,
      responseId: `baguqeera${'r'.repeat(52)}`,
      authorId: `baguqeera${'a'.repeat(80)}`,
    };

    await repo.putPairResponse(`baguqeera${'b'.repeat(80)}`, longResponse);

    const soul = [...graph.keys()][0];
    expect(Buffer.byteLength(soul, 'utf8')).toBeLessThan(240);
  });

  test('advances journal idempotently without changing object identity', async () => {
    const graph = new Map<string, unknown>();
    const repo = new GunDeliveryRepository({ put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
    await repo.recordDelivery({ objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'committed' });
    await repo.recordDelivery({ objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'sent' });
    await expect(repo.getDelivery('talk-cid', 'bob')).resolves.toMatchObject({ state: 'sent', objectId: 'talk-cid' });
    expect([...graph.keys()].filter((key) => key.includes('deliveryJournal/talk-cid/bob'))).toHaveLength(1);
  });
});
