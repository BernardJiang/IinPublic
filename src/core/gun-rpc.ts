/**
 * The device's one Gun, served to a GUI that runs none (OPEN-91 P5/P6). The GUI keeps Gun's chain
 * API through a thin client (src/web/services/remote-gun.ts) and sends each operation here; this
 * runs it on the real instance. Shared by both hosts: the native node (over loopback HTTP,
 * src/server/routes/gun-rpc-routes.ts) and the web worker (over `postMessage`, src/core/host).
 *
 *   { op: 'put' | 'once' | 'on' | 'off' | 'auth' | 'peer' | 'leave', … } → JSON answer
 *
 * A path is a list of keys from the root; a first key of '~user' means `gun.user()`. A subscription
 * (`on`) belongs to a session: its events go to that session's `emit`, and `closeSession` ends them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type GunRpcRequest = Record<string, any> & { op: string };
export type GunRpcEmit = (event: { sub: string; data: unknown; key: string }) => void;

export type GunRpcSession = {
  emit: GunRpcEmit;
  subs: Map<string, { off: () => void }>;
};

function resolve(gun: any, path: unknown): any {
  if (!Array.isArray(path) || path.length === 0) throw new Error('path required');
  const [first, ...rest] = path.map(String);
  let ref = first === '~user' ? gun.user() : gun.get(first);
  for (const key of rest) ref = ref.get(key);
  return ref;
}

/** Gun hands callbacks live graph nodes; a copy is what crosses to the GUI. */
function plain(data: unknown): unknown {
  if (data === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return null;
  }
}

export function createGunRpcSession(emit: GunRpcEmit): GunRpcSession {
  return { emit, subs: new Map() };
}

export function closeGunRpcSession(session: GunRpcSession): void {
  for (const sub of session.subs.values()) sub.off();
  session.subs.clear();
}

/** Runs one operation; `session` is needed only by `on` and `off`. */
export function runGunRpc(gun: any, body: GunRpcRequest, session?: GunRpcSession | null): Promise<any> {
  return new Promise((answer, fail) => {
    let answered = false;
    const reply = (value: any): void => {
      if (answered) return;
      answered = true;
      answer(value);
    };
    try {
      switch (body.op) {
        case 'put': {
          resolve(gun, body.path).put(body.data, (ack: any) => reply({ ok: !ack?.err, err: ack?.err ? String(ack.err) : undefined }));
          // The device acks from its own storage; a missing ack is not a failed write.
          setTimeout(() => reply({ ok: true }), Number(body.timeoutMs) || 8_000);
          return;
        }
        case 'once': {
          const ref = resolve(gun, body.path);
          if (body.map) {
            // `.map().once()`: every child seen within the wait, as [key, data] pairs.
            const items: Array<[string, unknown]> = [];
            ref.map().once((data: unknown, key: string) => { items.push([key, plain(data)]); });
            setTimeout(() => reply({ ok: true, items }), Math.min(Number(body.waitMs) || 300, 5_000));
            return;
          }
          ref.once((data: unknown, key: string) => {
            reply({ ok: true, data: plain(data), key, missing: data === undefined });
          }, body.waitMs ? { wait: Number(body.waitMs) } : undefined);
          setTimeout(() => reply({ ok: true, data: null, missing: true }), Math.min(Number(body.timeoutMs) || 8_000, 30_000));
          return;
        }
        case 'on': {
          if (!session) throw new Error('no such stream session');
          const subId = String(body.sub);
          let event: any = null;
          const listener = (data: unknown, key: string, _msg: unknown, ev: any) => {
            event = ev;
            session.emit({ sub: subId, data: plain(data), key });
          };
          const ref = resolve(gun, body.path);
          (body.map ? ref.map() : ref).on(listener);
          session.subs.set(subId, { off: () => event?.off?.() });
          reply({ ok: true });
          return;
        }
        case 'off': {
          session?.subs.get(String(body.sub))?.off();
          session?.subs.delete(String(body.sub));
          reply({ ok: true });
          return;
        }
        case 'auth': {
          // The owner's keypair, from this app's own GUI, so `~user` writes are signed here.
          gun.user().auth(body.pair, (ack: any) => reply({ ok: !ack?.err, err: ack?.err ? String(ack.err) : undefined }));
          setTimeout(() => reply({ ok: true, timedOut: true }), 5_000);
          return;
        }
        case 'peer': {
          // Another phone's node (OPEN-36 offline mode: LAN or Wi-Fi Direct), found by the GUI.
          const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((url: string) => /^https?:\/\//.test(url));
          if (urls.length) gun.opt({ peers: urls });
          reply({ ok: true });
          return;
        }
        case 'leave':
          gun.user().leave?.();
          reply({ ok: true });
          return;
        default:
          throw new Error(`unknown op ${String(body.op)}`);
      }
    } catch (error) {
      answered = true;
      fail(error);
    }
  });
}
