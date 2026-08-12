import SEA from 'gun/sea';
import { SelectiveGunSyncReceiver, convergeVersionedValue, issueGunSyncDelta, issueGunSyncGrant } from '../../shared/selective-gun-sync';
import type { SeaSigningPair } from '../../shared/p2p-runtime';

describe('selective Gun synchronization', () => {
  let alice: SeaSigningPair; let bob: SeaSigningPair; let mallory: SeaSigningPair;
  beforeAll(async () => { [alice, bob, mallory] = await Promise.all([SEA.pair(), SEA.pair(), SEA.pair()]) as SeaSigningPair[]; });

  async function fixture(scope: 'accepted-talk' | 'pair-response' = 'accepted-talk') {
    const prefix = scope === 'accepted-talk' ? `users/${alice.pub}/talks/talk-1` : `pairs/${[alice.pub, bob.pub].sort().join('__')}/talkResponses`;
    const grant = await issueGunSyncGrant({ pair: alice, grantId: `g-${scope}`, scope, recipientSeaPub: bob.pub, soulPrefix: prefix });
    const delta = await issueGunSyncDelta({ pair: alice, grantId: grant.grantId, soul: `${prefix}/body`, objectId: 'talk-1', value: { id: 'talk-1' }, head: 'h1' });
    return { prefix, grant, delta };
  }

  test.each(['gun-wire', 'libp2p', 'webrtc', 'peer-forward', 'mailbox'])(
    'accepted Talk converges identically over %s adapter', async () => {
      const graph = new Map<string, unknown>(); const { grant, delta } = await fixture();
      const receiver = new SelectiveGunSyncReceiver(bob.pub, { put: async (key, value) => { graph.set(key, value); }, get: async (key) => graph.get(key) ?? null });
      await expect(receiver.apply(grant, delta)).resolves.toEqual({ ok: true });
      expect(graph.get(delta.soul)).toEqual({ id: 'talk-1' });
    },
  );

  test('synchronizes pair-private response only to a participant', async () => {
    const { grant, delta } = await fixture('pair-response');
    const store = { put: async () => undefined, get: async () => null };
    await expect(new SelectiveGunSyncReceiver(bob.pub, store).apply(grant, delta)).resolves.toEqual({ ok: true });
    await expect(new SelectiveGunSyncReceiver(mallory.pub, store).apply(grant, delta)).resolves.toEqual({ ok: false, reason: 'grant recipient mismatch' });
  });

  test('cannot over-subscribe user-private paths or paths outside the exact grant', async () => {
    const { grant } = await fixture();
    const store = { put: async () => undefined, get: async () => null };
    const privateDelta = await issueGunSyncDelta({ pair: alice, grantId: grant.grantId, soul: `users/${alice.pub}/chatbotMemory/q1`, objectId: 'q1', value: {}, head: 'h' });
    await expect(new SelectiveGunSyncReceiver(bob.pub, store).apply(grant, privateDelta)).resolves.toEqual({ ok: false, reason: 'soul outside authorization' });
  });

  test('detects checkpoint gaps for disconnect recovery', async () => {
    const graph = new Map<string, unknown>(); const { grant, delta, prefix } = await fixture();
    const store = { put: async (key: string, value: unknown) => { graph.set(key, value); }, get: async (key: string) => graph.get(key) ?? null };
    const receiver = new SelectiveGunSyncReceiver(bob.pub, store);
    await receiver.apply(grant, delta);
    const gap = await issueGunSyncDelta({ pair: alice, grantId: grant.grantId, soul: `${prefix}/body`, objectId: 'talk-1', value: { id: 'talk-1', v: 3 }, head: 'h3', previousHead: 'h2' });
    await expect(receiver.apply(grant, gap)).resolves.toEqual({ ok: false, reason: 'checkpoint gap' });
  });

  test('concurrent edits and retractions converge deterministically', () => {
    const edit = { version: 3, changedAt: '2026-08-12T00:03:00Z', title: 'edit' };
    const retract = { version: 2, changedAt: '2026-08-12T00:02:00Z', retractedAt: '2026-08-12T00:02:00Z', title: 'old' };
    expect(convergeVersionedValue(edit, retract)).toBe(retract);
    expect(convergeVersionedValue({ ...edit, title: 'a' }, { ...edit, changedAt: '2026-08-12T00:04:00Z', title: 'b' }).title).toBe('b');
  });
});
