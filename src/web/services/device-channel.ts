/**
 * The page's one connection to its own embedded node (src/server/routes/device-channel.ts): core
 * requests, Gun operations and Gun events over a single WebSocket instead of HTTP requests that
 * queue behind the WebView's 6 connections per origin (2026-11-16: 179 queued, 3–61 s for
 * `/health`). Each request says its lane: `bulk` (offers, imports) is capped on the node; `ui` runs
 * at once.
 *
 * The socket reconnects on its own. While it is down — or if it never opens (an older node) —
 * `request` rejects with `DeviceChannelUnavailable`, and callers fall back to the HTTP routes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DeviceChannelLane = 'ui' | 'bulk';
export type DeviceChannelKind = 'core' | 'gun';
type GunEvent = { sub: string; data: unknown; key: string };
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | null };

export class DeviceChannelUnavailable extends Error {
  constructor(message = 'device channel is not open') {
    super(message);
    this.name = 'DeviceChannelUnavailable';
  }
}

export type DeviceChannelOptions = {
  /** The node's origin, as the page loaded it (the loopback port on a phone). */
  baseUrl: string;
  token: string;
  /** How a socket is made (tests pass a fake). */
  createSocket?: (url: string) => WebSocket;
  /** A request with no answer after this long fails (default 120 s; offers can be slow). */
  requestTimeoutMs?: number;
};

export function deviceChannelUrl(baseUrl: string): string {
  const url = new URL('/api/device-channel', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export class DeviceChannel {
  private socket: WebSocket | null = null;
  private session: string | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private readyWaiters: Array<{ resolve: (session: string) => void; reject: (error: Error) => void }> = [];
  private readonly gunListeners = new Set<(event: GunEvent) => void>();
  private readonly closeListeners = new Set<() => void>();
  private retryMs = 500;
  private stopped = false;
  /** Opened at least once: the node has the channel, so a drop is temporary. */
  private everReady = false;

  constructor(private readonly options: DeviceChannelOptions) {}

  get isReady(): boolean {
    return this.session !== null;
  }

  get sessionId(): string | null {
    return this.session;
  }

  /** Opens the socket; resolves once the node accepted the secret (rejects if it does not). */
  connect(): Promise<string> {
    if (this.session) return Promise.resolve(this.session);
    const ready = new Promise<string>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
    if (!this.socket) this.open();
    return ready;
  }

  close(): void {
    this.stopped = true;
    this.socket?.close();
  }

  onGunEvent(listener: (event: GunEvent) => void): () => void {
    this.gunListeners.add(listener);
    return () => this.gunListeners.delete(listener);
  }

  /** Called whenever an open session ends (its Gun subscriptions are gone with it). */
  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  request(kind: DeviceChannelKind, body: unknown, lane: DeviceChannelLane = 'ui'): Promise<any> {
    const socket = this.socket;
    if (!socket || !this.session || socket.readyState !== 1) return Promise.reject(new DeviceChannelUnavailable());
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.requestTimeoutMs ?? 120_000;
      const timer = timeoutMs > 0
        ? setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`device channel: no answer to ${kind} request in ${Math.round(timeoutMs / 1000)} s`));
        }, timeoutMs)
        : null;
      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ t: 'req', id, kind, lane, body }));
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(new DeviceChannelUnavailable(String((error as Error)?.message || error)));
      }
    });
  }

  private open(): void {
    if (this.stopped) return;
    let socket: WebSocket;
    try {
      const url = deviceChannelUrl(this.options.baseUrl);
      socket = this.options.createSocket ? this.options.createSocket(url) : new WebSocket(url);
    } catch (error) {
      this.failWaiters(new DeviceChannelUnavailable(String((error as Error)?.message || error)));
      return;
    }
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ t: 'auth', token: this.options.token }));
    socket.onmessage = (message: MessageEvent) => this.handle(String(message.data));
    socket.onerror = () => undefined;
    socket.onclose = () => this.handleClose(socket);
  }

  private handle(text: string): void {
    let frame: any;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame?.t === 'res') {
      const waiter = this.pending.get(Number(frame.id));
      if (!waiter) return;
      this.pending.delete(Number(frame.id));
      if (waiter.timer) clearTimeout(waiter.timer);
      if (frame.ok) waiter.resolve(frame.value);
      else waiter.reject(new Error(String(frame.error || 'device channel request failed')));
    } else if (frame?.t === 'gun') {
      for (const listener of this.gunListeners) listener({ sub: frame.sub, data: frame.data, key: frame.key });
    } else if (frame?.t === 'ready' && typeof frame.session === 'string') {
      this.session = frame.session;
      this.everReady = true;
      this.retryMs = 500;
      for (const waiter of this.readyWaiters.splice(0)) waiter.resolve(frame.session);
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    const hadSession = this.session !== null;
    this.socket = null;
    this.session = null;
    for (const [id, waiter] of this.pending) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new DeviceChannelUnavailable('device channel closed'));
      this.pending.delete(id);
    }
    if (hadSession) for (const listener of this.closeListeners) listener();
    // A node without the channel (or a wrong secret) never says ready: fall back to HTTP for good.
    if (!this.everReady) {
      this.failWaiters(new DeviceChannelUnavailable('device channel refused'));
      return;
    }
    if (this.stopped) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 10_000);
    setTimeout(() => this.open(), delay);
  }

  private failWaiters(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) waiter.reject(error);
  }
}

/** Core requests that are bulk work: capped on the node so they never hold up what a person waits for. */
export const BULK_CORE_REQUESTS: ReadonlySet<string> = new Set([
  'graph.offer',
  'graph.offerMany',
  'graph.importRemembered',
  'graph.trimLog',
  'collection.eraseRetired',
]);

export function coreLane(request: { name?: unknown }): DeviceChannelLane {
  return BULK_CORE_REQUESTS.has(String(request?.name ?? '')) ? 'bulk' : 'ui';
}
