import Gun from 'gun';
import { installSharingPolicy } from '../../core/sharing-policy';
import { SharingInterests } from '../../core/sharing-interests';
import { closeGunRpcSession, createGunRpcSession, runGunRpc } from '../../core/gun-rpc';

/* eslint-disable @typescript-eslint/no-explicit-any */
installSharingPolicy(Gun);
const wait = () => new Promise((resolve) => setTimeout(resolve, 80));
function device() {
  const gun = (Gun as any)({ peers: [], localStorage: false, radisk: false, axe: false, multicast: false });
  const peer = { id: 'relay', wire: { send: jest.fn() } };
  let index = 0;
  const put = (soul: string, fields: Record<string, unknown>) => gun._.opt.mesh.hear(JSON.stringify({
    '#': `remote-${index++}`, put: { [soul]: { _: { '#': soul, '>': Object.fromEntries(Object.keys(fields).map((key) => [key, Date.now() + index / 1000])) }, ...fields } },
  }), peer);
  return { gun, put };
}

describe('device read interests at the network boundary', () => {
  it('rejects unsolicited public records and accepts only requested ancestor fields', async () => {
    const { gun, put } = device();
    gun.get('public').get('wanted').get('card').on(() => {});
    put('public', { wanted: { '#': 'public/wanted' }, other: { '#': 'public/other' } });
    put('public/wanted/card', { name: 'wanted' });
    put('public/other/card', { name: 'unrelated' });
    await wait();
    expect(gun._.graph.public?.other).toBeUndefined();
    expect(gun._.graph['public/wanted/card']?.name).toBe('wanted');
    expect(gun._.graph['public/other/card']).toBeUndefined();
    gun.get('public').off();
  });

  it('does not turn a remote GET into permission to populate storage', async () => {
    const { gun, put } = device();
    gun._.opt.mesh.hear(JSON.stringify({ '#': 'remote-get', get: { '#': 'public/unrequested' } }), { id: 'attacker', wire: { send: jest.fn() } });
    put('public/unrequested', { value: 'injection' });
    await wait();
    expect(gun._.graph['public/unrequested']).toBeUndefined();
  });

  it('keeps two sessions independent and revokes even a never-fired subscription', async () => {
    const { gun, put } = device();
    const a = createGunRpcSession(jest.fn());
    const b = createGunRpcSession(jest.fn());
    const on = { op: 'on', path: ['public', 'stream'], sub: 'same-id', map: true };
    await runGunRpc(gun, on, a);
    await runGunRpc(gun, on, b);
    closeGunRpcSession(a); // no data/event.off yet
    put('public/stream/first', { value: 'one' });
    await wait();
    expect(gun._.graph['public/stream/first']?.value).toBe('one');
    closeGunRpcSession(b);
    put('public/stream/second', { value: 'two' });
    await wait();
    expect(gun._.graph['public/stream/second']).toBeUndefined();
    expect(a.emit).not.toHaveBeenCalled();
  });

  it('expires one-time read interests and keeps live ones until cancellation', () => {
    let now = 0;
    const policy = new SharingInterests(() => now);
    const root = {};
    const chain = (path: string) => ({ _: { root, soul: path, get: path, back: root } });
    const cb = () => {};
    policy.add(chain('public/read'), cb, true);
    const stop = policy.add(chain('public/live'), () => {}, false);
    now = 29_999;
    expect(policy.acceptsField('public/read', 'value')).toBe(true);
    now = 30_000;
    expect(policy.acceptsField('public/read', 'value')).toBe(false);
    expect(policy.acceptsField('public/live', 'value')).toBe(true);
    stop();
    expect(policy.acceptsField('public/live', 'value')).toBe(false);
  });
});
