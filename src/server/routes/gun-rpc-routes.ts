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
import type { ServerResponse } from 'http';
import type express from 'express';
import { closeGunRpcSession, createGunRpcSession, runGunRpc, type GunRpcSession } from '../../core/gun-rpc';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** More unread events than this means the page has stopped reading (OPEN-100). */
export const GUN_RPC_STREAM_BACKLOG_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * Writes to a stream whose reader may have stopped. A frozen WebView keeps its socket open, so
 * Node would otherwise queue every event in memory until the heap limit kills the app. Past the
 * limit the stream is dropped: RemoteGun reopens it and resubscribes, and Gun then sends each
 * subscription's current state, so nothing is lost but the backlog.
 */
export function writeBoundedStream(
  res: Pick<ServerResponse, 'destroyed' | 'destroy' | 'write' | 'writableLength'>,
  text: string,
  limitBytes = GUN_RPC_STREAM_BACKLOG_LIMIT_BYTES,
): void {
  if (res.destroyed) return;
  if (res.writableLength > limitBytes) {
    res.destroy();
    return;
  }
  res.write(text);
}

export function registerGunRpcRoutes(app: express.Application, gun: any, token: string): void {
  const sessions = new Map<string, GunRpcSession>();
  const authorized = (req: express.Request): boolean => token.length >= 32 && req.get('authorization') === `Bearer ${token}`;

  app.get('/api/gun-rpc/stream', (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    const id = crypto.randomBytes(12).toString('hex');
    sessions.set(id, createGunRpcSession((event) => writeBoundedStream(res, `${JSON.stringify(event)}\n`)));
    res.status(200).set({ 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.flushHeaders?.();
    res.write(`${JSON.stringify({ session: id })}\n`);
    const keepAlive = setInterval(() => writeBoundedStream(res, '\n'), 25_000);
    res.on('close', () => {
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
