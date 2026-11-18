/**
 * One WebSocket between the app's WebView and its own embedded node (2026-11-16): the device core
 * (`/api/core`) and the device Gun (`/api/gun-rpc`, its event stream) on a single connection.
 *
 * Why: a WebView opens at most 6 HTTP/1.1 connections to one origin, and the app's page talks to
 * its node at `127.0.0.1:8088`. Under load (four phones exchanging 120 starter tags) up to 179
 * page→node requests queued behind those 6, `/health` took 3–61 s from the page against 9–90 ms
 * asked directly, and Nearby heartbeats timed out in the queue. A WebSocket is not in that pool,
 * and one socket carries any number of requests at once.
 *
 * Lanes: requests marked `bulk` (offers, imports) run at most `bulkConcurrency` at a time; every
 * other request runs at once. So a person's tap, a heartbeat's state read or a Gun subscription
 * never waits behind a thousand offers.
 *
 * Frames (JSON text):
 *   page → node  { t: 'auth', token }                                  first frame, within 5 s
 *   node → page  { t: 'ready', session }                               Gun events use this session
 *   page → node  { t: 'req', id, kind: 'core' | 'gun', lane?: 'ui' | 'bulk', body }
 *   node → page  { t: 'res', id, ok: true, value } | { t: 'res', id, ok: false, error }
 *   node → page  { t: 'gun', sub, data, key }                          a subscription's update
 *
 * Same secret as the HTTP routes (core-routes.ts): any program on the device can reach a loopback
 * port. A socket that does not authenticate is closed (4401), as is one whose reader stopped
 * (unsent frames over the backlog limit, like the HTTP event stream, OPEN-100).
 */
import crypto from 'crypto';
import type { IncomingMessage, Server } from 'http';
import type { Duplex } from 'stream';
import WebSocket from 'ws';
import { closeGunRpcSession, createGunRpcSession, runGunRpc } from '../../core/gun-rpc';
import type { CoreRequest } from '../../core/protocol';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEVICE_CHANNEL_PATH = '/api/device-channel';
export const DEVICE_CHANNEL_BACKLOG_LIMIT_BYTES = 4 * 1024 * 1024;
const AUTH_TIMEOUT_MS = 5_000;

export type DeviceChannelOptions = {
  token: string;
  core: (request: CoreRequest) => Promise<unknown>;
  gun: unknown;
  /** Bulk requests running at once (default 4). */
  bulkConcurrency?: number;
  backlogLimitBytes?: number;
};

type Job = { run: () => Promise<void> };

/** Runs `bulk` jobs at most `limit` at a time, in arrival order. */
export class BulkLane {
  private running = 0;
  private readonly queue: Job[] = [];

  constructor(private readonly limit: number) {}

  get depth(): number { return this.queue.length + this.running; }

  push(job: Job): void {
    this.queue.push(job);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.limit && this.queue.length) {
      const job = this.queue.shift()!;
      this.running += 1;
      void job.run().finally(() => {
        this.running -= 1;
        this.drain();
      });
    }
  }
}

function pathOf(req: IncomingMessage): string {
  const url = String(req.url || '');
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

/**
 * Routes each WebSocket upgrade by path. Gun's server (`/gun`) answers 400 to any other path, and
 * it was attached first, so a second server cannot simply listen too: the listeners present now
 * (Gun's, Socket.IO's) still get every other upgrade, and `DEVICE_CHANNEL_PATH` goes to ours.
 */
function routeUpgrades(server: Server, path: string, onUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void {
  const others = server.listeners('upgrade') as Array<(req: IncomingMessage, socket: Duplex, head: Buffer) => void>;
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (pathOf(req) === path) {
      onUpgrade(req, socket, head);
      return;
    }
    for (const listener of others) listener.call(server, req, socket, head);
  });
}

export function attachDeviceChannel(server: Server, options: DeviceChannelOptions): { close: () => void } {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  const bulk = new BulkLane(Math.max(1, options.bulkConcurrency ?? 4));
  const backlogLimit = options.backlogLimitBytes ?? DEVICE_CHANNEL_BACKLOG_LIMIT_BYTES;

  routeUpgrades(server, DEVICE_CHANNEL_PATH, (req, socket, head) => {
    wss.handleUpgrade(req, socket as any, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws: WebSocket) => {
    let authed = false;
    let session: ReturnType<typeof createGunRpcSession> | null = null;
    const sessionId = crypto.randomBytes(12).toString('hex');
    const send = (frame: Record<string, unknown>): void => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > backlogLimit) {
        // The page stopped reading (a frozen WebView): drop it, as the HTTP stream does. The page
        // reconnects and resubscribes, and Gun sends each subscription's current state again.
        ws.terminate();
        return;
      }
      ws.send(JSON.stringify(frame));
    };
    const authTimer = setTimeout(() => { if (!authed) ws.close(4401, 'auth'); }, AUTH_TIMEOUT_MS);

    const answer = async (id: unknown, kind: unknown, body: any): Promise<void> => {
      try {
        const value = kind === 'gun'
          ? await runGunRpc(options.gun, { ...(body ?? {}), session: sessionId }, session)
          : await options.core(body as CoreRequest);
        send({ t: 'res', id, ok: true, value: value === undefined ? null : value });
      } catch (error) {
        send({ t: 'res', id, ok: false, error: String((error as Error)?.message || error) });
      }
    };

    ws.on('message', (raw: WebSocket.Data) => {
      let frame: any;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!authed) {
        if (frame?.t === 'auth' && options.token.length >= 32 && frame.token === options.token) {
          authed = true;
          clearTimeout(authTimer);
          session = createGunRpcSession((event) => send({ t: 'gun', ...event }));
          send({ t: 'ready', session: sessionId });
        } else {
          ws.close(4401, 'auth');
        }
        return;
      }
      if (frame?.t !== 'req') return;
      const job = () => answer(frame.id, frame.kind, frame.body);
      if (frame.lane === 'bulk') bulk.push({ run: job });
      else void job();
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (session) closeGunRpcSession(session);
      session = null;
    });
    ws.on('error', () => undefined);
  });

  return { close: () => wss.close() };
}
