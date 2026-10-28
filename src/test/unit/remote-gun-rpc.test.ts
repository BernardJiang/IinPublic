/** OPEN-91 P5/P6: a GUI with no Gun of its own uses the device's through RemoteGun → runGunRpc. */
// radisk reads `Radix.object`, which Jest's module order leaves unset unless radix loads first.
import 'gun/lib/radix';
import Gun from 'gun';
import { closeGunRpcSession, createGunRpcSession, runGunRpc } from '../../core/gun-rpc';
import { RemoteGun, type GunRpcTransport } from '../../web/services/remote-gun';

/* eslint-disable @typescript-eslint/no-explicit-any */

function inProcess(gun: any): { transport: GunRpcTransport; close: () => void } {
  let onEvent: (event: any) => void = () => undefined;
  let onClose: () => void = () => undefined;
  const session = createGunRpcSession((event) => onEvent(event));
  return {
    transport: {
      // A structured copy, as postMessage and JSON both make.
      call: async (body) => JSON.parse(JSON.stringify(await runGunRpc(gun, JSON.parse(JSON.stringify(body)), session))),
      open: (listener, closed) => {
        onEvent = listener;
        onClose = closed;
        return Promise.resolve('one');
      },
    },
    close: () => {
      closeGunRpcSession(session);
      onClose();
    },
  };
}

const eventually = async (check: () => boolean, ms = 2_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('RemoteGun over the device Gun RPC', () => {
  it('releases fire-and-forget signaling RPCs without waiting for storage acknowledgements', async () => {
    jest.useFakeTimers();
    try {
      const put = jest.fn();
      const node = { get: () => node, put };
      const { transport } = inProcess(node);
      let pending = 0;
      const remote = new RemoteGun({ ...transport, call: async (body) => {
        pending += 1;
        try { return await transport.call(body); } finally { pending -= 1; }
      } });
      // Signaling is ephemeral and its Gun writes need not produce a storage ack. Six held
      // HTTP requests can otherwise block the WebView's handshake and subscription requests.
      for (let i = 0; i < 6; i += 1) remote.get('p2p-signal').get(`frame-${i}`).put({ frame: 'signal' });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      expect(put).toHaveBeenCalledTimes(6);
      expect(pending).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('still waits for and reports a write rejection when the caller requests an acknowledgement', async () => {
    jest.useFakeTimers();
    try {
      let ack: (result: unknown) => void = () => undefined;
      const node = { get: () => node, put: (_data: unknown, cb: typeof ack) => { ack = cb; } };
      const remote = new RemoteGun(inProcess(node).transport);
      const callback = jest.fn();
      remote.get('profile').put({ name: 'Ann' }, callback);
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      expect(callback).not.toHaveBeenCalled();
      ack({ err: 'storage unavailable' });
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      expect(callback).toHaveBeenCalledWith({ err: 'storage unavailable' });
    } finally {
      jest.useRealTimers();
    }
  });

  // Stored, as the worker's and the node's are: a Gun without storage never answers a read.
  const files = new Map<string, unknown>();
  const store = {
    put: (key: string, data: unknown, cb: (err: unknown, ok?: unknown) => void) => { files.set(key, data); cb(null, 1); },
    get: (key: string, cb: (err: unknown, data?: unknown) => void) => cb(null, files.get(key) ?? null),
  };
  const gun = (Gun as any)({ peers: [], localStorage: false, store, axe: false, multicast: false });

  it('writes and reads back a node, and reports a missing one as undefined', async () => {
    const remote = new RemoteGun(inProcess(gun).transport);
    await new Promise<void>((resolve, reject) => remote.get('rpc-test').get('a').put({ name: 'Ann' }, (ack) => (ack.err ? reject(new Error(ack.err)) : resolve())));
    const read = await new Promise<any>((resolve) => remote.get('rpc-test').get('a').once((data) => resolve(data)));
    expect(read.name).toBe('Ann');
    const missing = await new Promise<any>((resolve) => remote.get('rpc-test').get('nobody').once((data) => resolve(data ?? 'none'), { wait: 50 }));
    expect(missing).toBe('none');
  });

  it('lists children with map().once()', async () => {
    const remote = new RemoteGun(inProcess(gun).transport);
    gun.get('rpc-list').get('x').put({ v: 1 });
    gun.get('rpc-list').get('y').put({ v: 2 });
    const keys: string[] = [];
    remote.get('rpc-list').map().once((_data, key) => keys.push(key));
    await eventually(() => keys.length === 2);
    expect(keys.sort()).toEqual(['x', 'y']);
  });

  it('streams changes to on() until off()', async () => {
    const remote = new RemoteGun(inProcess(gun).transport);
    const seen: number[] = [];
    const chain = remote.get('rpc-live');
    chain.on((data) => { if (data?.n !== undefined) seen.push(data.n); });
    await new Promise((r) => setTimeout(r, 20));
    remote.get('rpc-live').put({ n: 1 });
    await eventually(() => seen.includes(1));
    chain.off();
    await new Promise((r) => setTimeout(r, 20));
    gun.get('rpc-live').put({ n: 2 });
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).not.toContain(2);
  });

  it("fires 'hi' on the transport's peer signal when it has one", async () => {
    let peer: () => void = () => undefined;
    const { transport } = inProcess(gun);
    const remote = new RemoteGun({ ...transport, onPeer: (cb) => { peer = cb; } });
    let hi = false;
    remote.on('hi', () => { hi = true; });
    await new Promise<void>((resolve) => remote.get('rpc-hi').put({ a: 1 }, () => resolve()));
    expect(hi).toBe(false);
    peer();
    expect(hi).toBe(true);
  });
});
