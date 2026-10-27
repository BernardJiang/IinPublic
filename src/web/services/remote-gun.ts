/**
 * The GUI's Gun when it runs none (OPEN-91 P5/P6): the device's one Gun is the app's embedded node
 * on native, and the core worker on the web. This is a thin client with the part of Gun's chain API
 * the app uses — `get`, `put`, `once`, `on`, `off`, `map`, `user().auth` — that keeps no graph and
 * no storage and sends each operation (src/core/gun-rpc.ts) to that Gun through a transport:
 * loopback HTTP with the shell's secret, or the worker's `postMessage`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Callback = (data: any, key: string, msg?: unknown, ev?: { off: () => void }) => void;
type Sub = { path: string[]; map: boolean; cb: Callback };
type GunEvent = { sub: string; data: unknown; key: string };

/** How operations reach the device's Gun, and how subscription events come back. */
export interface GunRpcTransport {
  call(body: Record<string, unknown>): Promise<any>;
  /**
   * Starts a session whose subscription events go to `onEvent`; resolves to its id. `onClose` is
   * called if the session ends (every subscription in it is then gone).
   */
  open(onEvent: (event: GunEvent) => void, onClose: () => void): Promise<string>;
  /** The device's Gun reached a peer ('hi'); a transport that cannot tell leaves this out. */
  onPeer?(cb: () => void): void;
}

/** The app's node over loopback (native): POST /api/gun-rpc, events on one streamed response. */
export function httpGunTransport(baseUrl: string, token: string): GunRpcTransport {
  return {
    async call(body) {
      const response = await fetch(`${baseUrl}/api/gun-rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const answer = await response.json().catch(() => null);
      if (!response.ok || !answer) throw new Error(answer?.err || `node Gun answered ${response.status}`);
      return answer;
    },
    open(onEvent, onClose) {
      return new Promise<string>((resolveSession, rejectSession) => {
        void (async () => {
          try {
            const response = await fetch(`${baseUrl}/api/gun-rpc/stream`, { headers: { authorization: `Bearer ${token}` } });
            if (!response.ok || !response.body) throw new Error(`node Gun stream answered ${response.status}`);
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let newline = buffer.indexOf('\n');
              while (newline >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf('\n');
                if (!line) continue;
                const message = JSON.parse(line);
                if (message.session) resolveSession(message.session);
                else onEvent(message);
              }
            }
          } catch (error) {
            rejectSession(error);
          }
          onClose();
        })();
      });
    },
  };
}

export class RemoteGun {
  private session: Promise<string> | null = null;
  private readonly subs = new Map<string, Sub>();
  private nextSub = 0;
  private readonly hiListeners: Array<() => void> = [];
  private connected = false;

  constructor(private readonly transport: GunRpcTransport) {
    // A transport that sees the device's peers says when one answers; otherwise the first answer.
    transport.onPeer?.(() => this.markConnected());
  }

  get(key: string): RemoteChain {
    return new RemoteChain(this, [String(key)], false);
  }

  user(): RemoteChain {
    return new RemoteChain(this, ['~user'], false);
  }

  /** Peers are the device Gun's business; 'hi' fires once it answers (or reaches a peer). */
  on(event: string, cb: () => void): void {
    if (event !== 'hi') return;
    if (this.connected) cb();
    else this.hiListeners.push(cb);
  }

  /** Peers belong to the device's Gun: another phone's node found here is handed to it. */
  opt(options?: { peers?: string[] }): void {
    if (options?.peers?.length) void this.rpc({ op: 'peer', urls: options.peers }).catch(() => undefined);
  }

  private markConnected(): void {
    if (this.connected) return;
    this.connected = true;
    for (const cb of this.hiListeners.splice(0)) cb();
  }

  async rpc(body: Record<string, unknown>): Promise<any> {
    const answer = await this.transport.call(body);
    if (!answer) throw new Error('device Gun gave no answer');
    if (!this.transport.onPeer) this.markConnected();
    return answer;
  }

  /** One session carries every subscription; reopened (and re-subscribed) if it ends. */
  private openSession(): Promise<string> {
    this.session ??= this.transport.open(
      (event) => {
        const sub = this.subs.get(event.sub);
        if (sub) sub.cb(event.data ?? undefined, event.key, undefined, { off: () => this.unsubscribe(event.sub) });
      },
      () => {
        // Ended: the next subscription (and every live one, now) uses a new session.
        this.session = null;
        if (this.subs.size > 0) setTimeout(() => void this.resubscribeAll(), 1_000);
      },
    );
    return this.session;
  }

  private async resubscribeAll(): Promise<void> {
    try {
      const session = await this.openSession();
      for (const [id, sub] of this.subs) await this.rpc({ op: 'on', session, sub: id, path: sub.path, map: sub.map });
    } catch {
      setTimeout(() => void this.resubscribeAll(), 2_000);
    }
  }

  subscribe(path: string[], map: boolean, cb: Callback): string {
    const id = `s${++this.nextSub}`;
    this.subs.set(id, { path, map, cb });
    void this.openSession()
      .then((session) => this.rpc({ op: 'on', session, sub: id, path, map }))
      .catch(() => setTimeout(() => void this.resubscribeAll(), 2_000));
    return id;
  }

  unsubscribe(id: string): void {
    if (!this.subs.delete(id)) return;
    void this.session?.then((session) => this.rpc({ op: 'off', session, sub: id })).catch(() => undefined);
  }
}

export class RemoteChain {
  private readonly mine = new Set<string>();

  constructor(private readonly root: RemoteGun, private readonly path: string[], private readonly mapped: boolean) {}

  get(key: string): RemoteChain {
    if (this.mapped) throw new Error('remote Gun: get() after map() is not supported');
    return new RemoteChain(this.root, [...this.path, String(key)], false);
  }

  map(): RemoteChain {
    return new RemoteChain(this.root, this.path, true);
  }

  put(data: unknown, cb?: (ack: { err?: string; ok?: boolean }) => void): RemoteChain {
    this.root.rpc({ op: 'put', path: this.path, data })
      .then((answer) => cb?.(answer.ok ? { ok: true } : { err: answer.err || 'put failed' }))
      .catch((error) => cb?.({ err: String((error as Error).message || error) }));
    return this;
  }

  once(cb: Callback, options?: { wait?: number }): RemoteChain {
    const last = this.path[this.path.length - 1] || '';
    this.root.rpc({ op: 'once', path: this.path, map: this.mapped, ...(options?.wait ? { waitMs: options.wait } : {}) })
      .then((answer) => {
        if (this.mapped) {
          for (const [key, data] of answer.items ?? []) cb(data, key);
          return;
        }
        cb(answer.missing ? undefined : answer.data, answer.key || last);
      })
      .catch(() => { if (!this.mapped) cb(undefined, last); });
    return this;
  }

  on(cb: Callback): RemoteChain {
    this.mine.add(this.root.subscribe(this.path, this.mapped, cb));
    return this;
  }

  off(): void {
    for (const id of this.mine) this.root.unsubscribe(id);
    this.mine.clear();
  }

  /** `gun.user().auth(pair, cb)`: the node signs this owner's `~user` writes. */
  auth(pair: unknown, cb?: (ack: { err?: string }) => void): void {
    this.root.rpc({ op: 'auth', pair })
      .then((answer) => cb?.(answer.ok ? {} : { err: answer.err || 'auth failed' }))
      .catch((error) => cb?.({ err: String((error as Error).message || error) }));
  }
}
