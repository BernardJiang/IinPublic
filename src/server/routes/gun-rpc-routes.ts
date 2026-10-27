/**
 * The app's one Gun, reached by its WebView (OPEN-91 P5): on native the WebView runs no Gun. Its
 * services keep Gun's chain API through a thin client (src/web/services/remote-gun.ts) that sends
 * each operation here, to this node's Gun — the device's only one, persisted on disk and peered
 * with the hub. Same secret as the device core (core-routes.ts): any program on the device can
 * reach a loopback port.
 *
 *   POST /api/gun-rpc          { op: 'put' | 'once' | 'on' | 'off' | 'auth' | 'leave', … } → JSON
 *   GET  /api/gun-rpc/stream   newline-delimited JSON: { session } first, then { sub, data, key }
 *
 * A path is a list of keys from the root; a first key of '~user' means `gun.user()`.
 * Subscriptions belong to a stream session and end with it.
 */
import crypto from 'crypto';
import type express from 'express';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Path = string[];
type Session = { res: express.Response; subs: Map<string, { off: () => void }> };

function resolve(gun: any, path: Path): any {
  if (!Array.isArray(path) || path.length === 0) throw new Error('path required');
  const [first, ...rest] = path.map(String);
  let ref = first === '~user' ? gun.user() : gun.get(first);
  for (const key of rest) ref = ref.get(key);
  return ref;
}

/** Gun hands callbacks live graph nodes; a copy is what crosses the wire. */
function plain(data: unknown): unknown {
  if (data === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(data));
  } catch {
    return null;
  }
}

export function registerGunRpcRoutes(app: express.Application, gun: any, token: string): void {
  const sessions = new Map<string, Session>();
  const authorized = (req: express.Request): boolean => token.length >= 32 && req.get('authorization') === `Bearer ${token}`;

  app.get('/api/gun-rpc/stream', (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    const id = crypto.randomBytes(12).toString('hex');
    const session: Session = { res, subs: new Map() };
    sessions.set(id, session);
    res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`${JSON.stringify({ session: id })}\n`);
    const keepAlive = setInterval(() => res.write('\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      for (const sub of session.subs.values()) sub.off();
      sessions.delete(id);
    });
  });

  app.post('/api/gun-rpc', (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    const body = req.body ?? {};
    try {
      switch (body.op) {
        case 'put': {
          let answered = false;
          const reply = (ack: any) => {
            if (answered) return;
            answered = true;
            res.json({ ok: !ack?.err, err: ack?.err ? String(ack.err) : undefined });
          };
          resolve(gun, body.path).put(body.data, reply);
          // This node acks from its own storage; a missing ack is not a failed write.
          setTimeout(() => reply({}), Number(body.timeoutMs) || 8_000);
          return;
        }
        case 'once': {
          const ref = resolve(gun, body.path);
          if (body.map) {
            // `.map().once()`: every child seen within the wait, as [key, data] pairs.
            const items: Array<[string, unknown]> = [];
            ref.map().once((data: unknown, key: string) => { items.push([key, plain(data)]); });
            setTimeout(() => res.json({ ok: true, items }), Math.min(Number(body.waitMs) || 300, 5_000));
            return;
          }
          let answered = false;
          ref.once((data: unknown, key: string) => {
            if (answered) return;
            answered = true;
            res.json({ ok: true, data: plain(data), key, missing: data === undefined });
          }, body.waitMs ? { wait: Number(body.waitMs) } : undefined);
          setTimeout(() => {
            if (answered) return;
            answered = true;
            res.json({ ok: true, data: null, missing: true });
          }, Math.min(Number(body.timeoutMs) || 8_000, 30_000));
          return;
        }
        case 'on': {
          const session = sessions.get(String(body.session));
          if (!session) throw new Error('no such stream session');
          const subId = String(body.sub);
          let event: any = null;
          const listener = (data: unknown, key: string, _msg: unknown, ev: any) => {
            event = ev;
            session.res.write(`${JSON.stringify({ sub: subId, data: plain(data), key })}\n`);
          };
          const ref = resolve(gun, body.path);
          (body.map ? ref.map() : ref).on(listener);
          session.subs.set(subId, { off: () => event?.off?.() });
          res.json({ ok: true });
          return;
        }
        case 'off': {
          const session = sessions.get(String(body.session));
          session?.subs.get(String(body.sub))?.off();
          session?.subs.delete(String(body.sub));
          res.json({ ok: true });
          return;
        }
        case 'auth': {
          // The owner's keypair, from this app's own WebView, so `~user` writes are signed here.
          let answered = false;
          gun.user().auth(body.pair, (ack: any) => {
            if (answered) return;
            answered = true;
            res.json({ ok: !ack?.err, err: ack?.err ? String(ack.err) : undefined });
          });
          setTimeout(() => {
            if (answered) return;
            answered = true;
            res.json({ ok: true, timedOut: true });
          }, 5_000);
          return;
        }
        case 'peer': {
          // Another phone's node (OPEN-36 offline mode: LAN or Wi-Fi Direct), found by the WebView.
          const urls = (Array.isArray(body.urls) ? body.urls : []).map(String).filter((url: string) => /^https?:\/\//.test(url));
          if (urls.length) gun.opt({ peers: urls });
          res.json({ ok: true });
          return;
        }
        case 'leave':
          gun.user().leave?.();
          res.json({ ok: true });
          return;
        default:
          throw new Error(`unknown op ${String(body.op)}`);
      }
    } catch (error) {
      res.status(400).json({ ok: false, err: (error as Error).message });
    }
  });
}
