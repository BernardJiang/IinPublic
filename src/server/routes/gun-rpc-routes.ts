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
 * The operations themselves are src/core/gun-rpc.ts, shared with the web worker. Subscriptions
 * belong to a stream session and end with it.
 */
import crypto from 'crypto';
import type express from 'express';
import { closeGunRpcSession, createGunRpcSession, runGunRpc, type GunRpcSession } from '../../core/gun-rpc';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function registerGunRpcRoutes(app: express.Application, gun: any, token: string): void {
  const sessions = new Map<string, GunRpcSession>();
  const authorized = (req: express.Request): boolean => token.length >= 32 && req.get('authorization') === `Bearer ${token}`;

  app.get('/api/gun-rpc/stream', (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    const id = crypto.randomBytes(12).toString('hex');
    sessions.set(id, createGunRpcSession((event) => res.write(`${JSON.stringify(event)}\n`)));
    res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`${JSON.stringify({ session: id })}\n`);
    const keepAlive = setInterval(() => res.write('\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      const session = sessions.get(id);
      if (session) closeGunRpcSession(session);
      sessions.delete(id);
    });
  });

  app.post('/api/gun-rpc', (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    const body = req.body ?? {};
    runGunRpc(gun, body, sessions.get(String(body.session)) ?? null)
      .then((answer) => res.json(answer))
      .catch((error) => res.status(400).json({ ok: false, err: (error as Error).message }));
  });
}
