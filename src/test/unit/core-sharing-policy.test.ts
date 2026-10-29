/** OPEN-91 P2: the sender's delivery records live in the device core, and private souls never leave the device. */
import Gun from 'gun';
import { createCoreHandler } from '../../core/core-handler';
import { DeliveryStore, DELIVERY_JOURNAL_PATH, SENT_RESPONSES_PATH } from '../../core/delivery';
import { memoryGraphStore } from '../../core/graph-store';
import { filterOutgoingGunMessage, guardMeshSay, installSharingPolicy, soulLeavesDevice } from '../../core/sharing-policy';
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
    await expect(afterRestart.getSentResponse('talk-cid', 'response-cid', 'alice')).resolves.toMatchObject({ payloadCiphertext: 'SEA{ciphertext}' });
    expect(await store.childKeys(SENT_RESPONSES_PATH)).toHaveLength(1);
    expect(SENT_RESPONSES_PATH.startsWith('local/') && DELIVERY_JOURNAL_PATH.startsWith('local/')).toBe(true);
  });

  it('advances the journal in place, through the handler every host uses', async () => {
    const store = memoryGraphStore();
    const handle = createCoreHandler(store);
    await handle({ name: 'delivery.record', input: { objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'committed' } });
    await handle({ name: 'delivery.record', input: { objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'sent' } });
    await expect(handle({ name: 'delivery.get', objectId: 'talk-cid', recipientId: 'bob' })).resolves.toMatchObject({ state: 'sent' });
    await handle({ name: 'delivery.record', input: { objectId: 'talk-cid', recipientId: 'bob', objectKind: 'talk-offer', state: 'committed' } });
    await expect(handle({ name: 'delivery.get', objectId: 'talk-cid', recipientId: 'bob' })).resolves.toMatchObject({ state: 'sent' });
    expect(await store.childKeys(DELIVERY_JOURNAL_PATH)).toHaveLength(1);
  });
});

describe('the sharing policy', () => {
  it('keeps private namespaces on the device', () => {
    for (const soul of ['local', 'local/exchanges/x', 'pairs/abc/talkResponses/t/r', 'deliveryJournal/o/r']) expect(soulLeavesDevice(soul)).toBe(false);
    for (const soul of ['users/u1', 'user-public-profile/u1', '~pub/profile']) expect(soulLeavesDevice(soul)).toBe(true);
  });

  it('denies unknown namespaces, including similar names and signed private answer memory', () => {
    for (const soul of ['localish/x', 'unreviewed/secret', 'talks/t1', 'publicish/x', '~pub/answers/private', '~pub/answers/private/qa1', '~pub/private/x']) {
      expect(soulLeavesDevice(soul)).toBe(false);
      expect(filterOutgoingGunMessage({ get: { '#': soul } })).toBeNull();
      expect(filterOutgoingGunMessage({ put: { [soul]: { secret: 'answer' } } })).toBeNull();
    }
    for (const soul of ['public/cards/a', 'p2p-signal/channel/frame', 'chatrooms/r/users', 'identity-links/a/b']) {
      expect(soulLeavesDevice(soul)).toBe(true);
    }
  });

  it('rejects wildcard soul reads and direct private field reads', () => {
    for (const get of [{ '#': { '*': '' } }, { '#': { '>': 'local' } }, { '#': 'users/pub', '.': 'private' }, { '#': '~pub/answers', '.': 'private' }]) {
      expect(filterOutgoingGunMessage({ get })).toBeNull();
    }
    expect(filterOutgoingGunMessage({ get: { '#': 'public/cards', '.': { '*': '' } } })).toBeTruthy();
  });

  it('strips private fields and SEA-signed private links, including their HAM timestamps', () => {
    const signedLink = 'SEA' + JSON.stringify({ m: { '#': '~pub/answers/private' }, s: 'signature' });
    const node = { _: { '#': '~pub/answers', '>': { private: 1, renamed: 2, public: 3 } }, private: signedLink, renamed: signedLink, public: 'yes' };
    const out = filterOutgoingGunMessage({ put: { '~pub/answers': node } });
    expect(out.put['~pub/answers']).toEqual({ _: { '#': '~pub/answers', '>': { public: 3 } }, public: 'yes' });
    expect(node.private).toBe(signedLink); // storage remains untouched
  });

  it('recognizes current Gun SEA packed link values as private too', () => {
    const packed = JSON.stringify({ ':': { '#': 'local/answer' }, '~': 'signature' });
    const out = filterOutgoingGunMessage({ put: { '~pub/profile': { safe: 'public', alias: packed } } });
    expect(out.put['~pub/profile']).toEqual({ safe: 'public' });
  });

  it('requires ciphertext envelopes in pair/room content and rejects cross-audience links', () => {
    const ciphertext = 'SEA' + JSON.stringify({ ct: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAAAAAA', s: 'AAAAAAAAAAAA' });
    for (const root of ['pair', 'room']) {
      const soul = `${root}/opaque/messages/m1`;
      const valid = { put: { [soul]: { content: ciphertext } } };
      expect(filterOutgoingGunMessage(valid)).toBe(valid);
      for (const value of ['answer', 'SEA{ciphertext}', 'SEA' + JSON.stringify({ m: 'signed plaintext', s: 'sig' }), 42, { '#': `${root}/other/messages/m1` }]) {
        expect(filterOutgoingGunMessage({ put: { [soul]: { content: value } } })).toBeNull();
      }
      expect(filterOutgoingGunMessage({ put: { [soul]: { content: null } } })).toBeTruthy();
      expect(filterOutgoingGunMessage({ put: { [`${root}/opaque`]: { messages: { '#': `${root}/opaque/messages` } } } })).toBeTruthy();
    }
  });

  it('drops malformed nodes and invalidates cached serialization and hash after filtering', () => {
    expect(filterOutgoingGunMessage({ put: { 'public/x': { _: { '#': 'local/secret' }, answer: 'x' } } })).toBeNull();
    const via = { id: 'peer' };
    const meta = Object.assign(function () {}, { via, raw: 'secret', $put: 'secret' });
    const out = filterOutgoingGunMessage({ '##': 'old-hash', _: meta, put: { 'public/x': { ok: true }, 'unknown/x': { secret: true } } });
    expect(out['##']).toBeUndefined();
    expect(out._.via).toBe(via);
    expect(out._.raw).toBeUndefined();
    expect(out._.$put).toBeUndefined();
  });

  it('drops private reads and strips private nodes from a mixed write', () => {
    expect(filterOutgoingGunMessage({ '#': '1', get: { '#': 'local/exchanges' } })).toBeNull();
    expect(filterOutgoingGunMessage({ '#': '2', put: { 'pairs/x': {} } })).toBeNull();
    const mixed = filterOutgoingGunMessage({ '#': '3', put: { 'users/u1': { a: 1 }, 'local/x': { b: 2 } } });
    expect(Object.keys(mixed.put)).toEqual(['users/u1']);
    const shared = { '#': '4', put: { 'users/u1': { a: 1 } } };
    expect(filterOutgoingGunMessage(shared)).toBe(shared);
  });

  it('keeps what the web worker held privately on the device, now that it peers with the hub (P6)', () => {
    for (const soul of ['users/pub1/private', 'users/pub1/private/talks/t1', 'device-local/cached-user', 'nodes/n1', 'edges/a/link/b']) {
      expect(soulLeavesDevice(soul)).toBe(false);
    }
    for (const soul of ['users/pub1', 'users/pub1/publicProfile', 'users/private']) expect(soulLeavesDevice(soul)).toBe(true);
  });

  it('removes links to private nodes from a shared node, with their state', () => {
    const out = filterOutgoingGunMessage({ '#': '5', put: { 'users/pub1': {
      _: { '#': 'users/pub1', '>': { name: 1, private: 1 } },
      name: 'Ann',
      private: { '#': 'users/pub1/private' },
    } } });
    expect(out.put['users/pub1']).toEqual({ _: { '#': 'users/pub1', '>': { name: 1 } }, name: 'Ann' });
  });

  it("sends an ack's status, never data a storage adapter put in it", () => {
    expect(filterOutgoingGunMessage({ '@': 'a', ok: '{"local":{"x":"secret"}}' })).toEqual({ '@': 'a', ok: 1 });
    expect(filterOutgoingGunMessage({ '@': 'a', ok: { local: { x: 'secret' } } }).ok).toBe(1);
    for (const ok of [1, 0, true, { '': 1 }]) {
      const ack = { '@': 'a', ok };
      expect(filterOutgoingGunMessage(ack)).toBe(ack);
    }
  });

  it("guards the mesh's say, where Gun re-asks for its subscriptions on reconnect", () => {
    const said: any[] = [];
    const mesh: any = { say(msg: any) { said.push(msg); return true; } };
    guardMeshSay(mesh);
    guardMeshSay(mesh); // once only
    expect(mesh.say({ get: { '#': 'local', '.': 'collections' } })).toBe(false);
    const shared = { get: { '#': 'users/u1' } };
    mesh.say(shared);
    const raw = function () { /* Gun's message meta */ } as any;
    raw.raw = '{"put":{"local/x":{"secret":1}}}';
    mesh.say({ '#': 'm', put: { 'users/u1': { a: 1 }, 'local/x': { secret: 1 } }, _: raw });
    expect(said[0]).toBe(shared);
    expect(said[1]).toEqual({ '#': 'm', put: { 'users/u1': { a: 1 } } });
    expect(said).toHaveLength(2);
  });

  it('rejects remote private injection before real Gun storage, including batched network messages', async () => {
    installSharingPolicy(Gun);
    const gun = (Gun as any)({ peers: [], localStorage: false, radisk: false, axe: false, multicast: false });
    const mesh = gun._.opt.mesh || (Gun as any).Mesh(gun._);
    guardMeshSay(mesh);
    const peer = { id: 'untrusted', wire: { send: jest.fn() } };
    const node = (soul: string, value: string) => ({ _: { '#': soul, '>': { value: Date.now() } }, value });
    const injected = ['local/injected', 'users/pub/private/injected', '~pub/answers/private/injected', 'unknown/injected'];
    mesh.hear(JSON.stringify(injected.map((soul, index) => ({ '#': `attack-${index}`, put: { [soul]: node(soul, 'remote') } }))), peer);
    gun.get('public/control').on(() => {});
    mesh.hear(JSON.stringify({ '#': 'public-control', put: { 'public/control': node('public/control', 'remote') } }), peer);
    gun.get('local/own').put({ value: 'local' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const soul of injected) expect(gun._.graph[soul]).toBeUndefined();
    expect(gun._.graph['public/control']?.value).toBe('remote');
    expect(gun._.graph['local/own']?.value).toBe('local');
    expect(mesh.sharingPolicy.violations.namespace).toBeGreaterThanOrEqual(injected.length);
    gun.off?.();
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
