/** OPEN-91 P2: the sender's delivery records live in the device core, and private souls never leave the device. */
import Gun from 'gun';
import { createCoreHandler } from '../../core/core-handler';
import { DeliveryStore, DELIVERY_JOURNAL_PATH, SENT_RESPONSES_PATH } from '../../core/delivery';
import { memoryGraphStore } from '../../core/graph-store';
import { filterOutgoingGunMessage, installSharingPolicy, soulLeavesDevice } from '../../core/sharing-policy';
import type { P2PMeshTalkResponsePayload } from '../../shared/p2p-mesh-protocol';

const response: P2PMeshTalkResponsePayload = {
  responseId: 'response-cid', talkId: 'talk-cid', authorId: 'alice', responderId: 'bob',
  submittedAt: '2026-08-12T00:00:00.000Z', respondedAt: '2026-08-12T00:00:00.000Z', version: 1,
  encryption: 'sea-ecdh-v1', payloadCiphertext: 'SEA{ciphertext}', transportMode: 'mesh-p2p',
};

describe('the delivery records in the device core', () => {
  it('keeps the response and its journal under local/, and recovers them after a restart', async () => {
    const store = memoryGraphStore();
    await new DeliveryStore(store).putSentResponse(response);
    await new DeliveryStore(store).record({ objectId: response.responseId, recipientId: 'alice', objectKind: 'talk-response', state: 'committed' });
    const afterRestart = new DeliveryStore(store);
    await expect(afterRestart.get(response.responseId, 'alice')).resolves.toMatchObject({ state: 'committed', objectId: response.responseId });
    await expect(afterRestart.getSentResponse('talk-cid', 'response-cid')).resolves.toMatchObject({ payloadCiphertext: 'SEA{ciphertext}' });
    expect(await store.childKeys(SENT_RESPONSES_PATH)).toHaveLength(1);
    expect(SENT_RESPONSES_PATH.startsWith('local/') && DELIVERY_JOURNAL_PATH.startsWith('local/')).toBe(true);
  });

  it('advances the journal in place, through the handler every host uses', async () => {
    const store = memoryGraphStore();
    const handle = createCoreHandler(store);
    await handle({ name: 'delivery.record', input: { objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'committed' } });
    await handle({ name: 'delivery.record', input: { objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'sent' } });
    await expect(handle({ name: 'delivery.get', objectId: 'talk-cid', recipientId: 'bob' })).resolves.toMatchObject({ state: 'sent' });
    expect(await store.childKeys(DELIVERY_JOURNAL_PATH)).toHaveLength(1);
  });
});

describe('the sharing policy', () => {
  it('keeps private namespaces on the device', () => {
    for (const soul of ['local', 'local/exchanges/x', 'pairs/abc/talkResponses/t/r', 'deliveryJournal/o/r']) expect(soulLeavesDevice(soul)).toBe(false);
    for (const soul of ['users/u1', 'user-public-profile/u1', '~pub/profile', 'localish/x']) expect(soulLeavesDevice(soul)).toBe(true);
  });

  it('drops private reads and strips private nodes from a mixed write', () => {
    expect(filterOutgoingGunMessage({ '#': '1', get: { '#': 'local/exchanges' } })).toBeNull();
    expect(filterOutgoingGunMessage({ '#': '2', put: { 'pairs/x': {} } })).toBeNull();
    const mixed = filterOutgoingGunMessage({ '#': '3', put: { 'users/u1': { a: 1 }, 'local/x': { b: 2 } } });
    expect(Object.keys(mixed.put)).toEqual(['users/u1']);
    const shared = { '#': '4', put: { 'users/u1': { a: 1 } } };
    expect(filterOutgoingGunMessage(shared)).toBe(shared);
  });

  it('sits ahead of the wire on a real Gun instance; local writes still land', async () => {
    installSharingPolicy(Gun);
    // A later create hook stands in for the mesh: it only sees what the policy lets through.
    const sent = new Set<string>();
    (Gun as any).on('create', function (this: any, root: any) {
      this.to.next(root);
      root.on('out', function (this: any, msg: any) {
        for (const soul of Object.keys(msg?.put ?? {})) sent.add(soul);
        if (msg?.get?.['#']) sent.add(`get:${msg.get['#']}`);
        this.to.next(msg);
      });
    });
    const gun = (Gun as any)({ peers: [], localStorage: false, radisk: false, axe: false, multicast: false });
    // Direct souls: with nothing to answer the parent lookup, a chained put never resolves in Node.
    gun.get('local/secret').put({ answer: 'mine' });
    gun.get('users/u1').put({ name: 'Ann' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Kept on the device: the write is in the instance's own graph.
    expect(gun._.graph['local/secret']?.answer).toBe('mine');
    expect([...sent].some((soul) => soul.replace(/^get:/, '').split('/')[0] === 'local')).toBe(false);
    expect(sent.has('users/u1')).toBe(true);
    gun.off?.();
  });
});
