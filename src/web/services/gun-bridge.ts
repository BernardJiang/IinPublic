/**
 * gun-bridge.ts — Main-thread interface to the Gun.js Web Worker
 *
 * Usage:
 *   const bridge = new GunBridge('/core-worker.js');
 *   await bridge.init({ hubUrl: 'https://localhost:8080/gun' });
 *
 *   await bridge.put('some/path', { hello: 'world' });
 *   const data = await bridge.get('some/path');
 *
 *   const unsub = bridge.subscribe('some/path', (data) => console.log(data));
 *   unsub(); // stop listening
 *
 *   const { pub } = await bridge.createAccount();
 *   await bridge.login(storedPair);
 *   await bridge.putPublic('bio', { name: 'Alice' });
 *   await bridge.putPrivate('diary', { note: 'secret' });
 *   const diary = await bridge.getPrivate('diary');
 */

import type { CoreRequest, CoreResponse } from '../../core/protocol';
import type { GunRpcTransport } from './remote-gun';

export type GunPair = { pub: string; priv: string; epub: string; epriv: string };

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class GunBridge {
  private worker: Worker | MessagePort | null = null;
  private sharedWorker: SharedWorker | null = null;
  private closed = false;
  private initOptions: { hubUrl?: string; peer?: boolean; isolated?: boolean } = {};
  private loginPair: GunPair | null = null;
  private authPair: GunPair | null = null;
  private credentialGeneration = 0;
  private clientLease: string | undefined;
  private releaseLease: (() => void) | undefined;
  private recovery: Promise<void> | null = null;
  private workerSession: string | null = null;
  private subscriptionRequests = new Map<string, { type: string; payload: any }>();
  private readonly onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) this.terminate(); };
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, (data: any, key?: string) => void>();
  private gunEventListener: ((event: { sub: string; data: unknown; key: string }) => void) | null = null;
  private readonly peerListeners: Array<() => void> = [];
  private readonly closeListeners: Array<() => void> = [];
  private readonly collectionListeners = new Set<(collection: string) => void>();
  private hubPeerSeen = false;
  private nextId = 1;
  private nextSubId = 1;
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: any) => void;

  constructor(private readonly workerUrl: string = '/core-worker.js') {
    this.readyPromise = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });

    // Avoid an unhandled ready rejection when an init request fails first.
    void this.readyPromise.catch(() => undefined);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.onPageHide);
  }

  private startWorker(isolated: boolean): void {
    if (this.worker) return;
    if (!isolated && typeof SharedWorker !== 'undefined') {
      try {
        this.sharedWorker = new SharedWorker(this.workerUrl, { name: 'iinpublic-device-core-v1' });
        this.worker = this.sharedWorker.port;
        this.sharedWorker.onerror = (event) => this.fail(new Error(event.message || 'Shared core worker failed'));
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.start();
        return;
      } catch {
        // Some browsers expose the constructor but disallow it in this context. The dedicated
        // host still has to acquire the storage lock; it cannot bypass ownership coordination.
        this.sharedWorker = null;
      }
    }
    const worker = new Worker(isolated ? `${this.workerUrl}${this.workerUrl.includes('?') ? '&' : '?'}isolated=1` : this.workerUrl);
    worker.onerror = (event) => this.fail(new Error(event.message || 'Core worker failed'));
    worker.onmessage = this.handleMessage.bind(this);
    this.worker = worker;
  }

  private fail(error: Error): void {
    for (const req of this.pending.values()) { clearTimeout(req.timer); req.reject(error); }
    this.pending.clear();
    if (!this.ready) this.rejectReady(error);
    for (const cb of this.closeListeners.splice(0)) cb();
  }

  private recover(): void {
    this.fail(new Error('Device core owner restarted; unconfirmed requests were not retried'));
    this.ready = false;
    this.readyPromise = new Promise<void>((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    void this.readyPromise.catch(() => undefined);
    this.recovery = (async () => {
      await this.sendRaw('init', { ...this.initOptions, clientLease: this.clientLease });
      await this.whenReady();
      if (this.loginPair) await this.sendRaw('login', { pair: this.loginPair });
      if (this.authPair) await this.sendRaw('gunRpc', { op: 'auth', pair: this.authPair });
      for (const { type, payload } of this.subscriptionRequests.values()) await this.sendRaw(type, payload);
      for (const listener of this.collectionListeners) listener('*');
    })();
    void this.recovery.catch((error) => this.fail(error));
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data;
    if (msg.type === 'core-session') {
      const replaced = this.workerSession !== null && this.workerSession !== msg.session;
      this.workerSession = msg.session;
      if (replaced) this.recover();
      return;
    }
    if (msg.type === 'core-reset') { this.recover(); return; }
    if (msg.type === 'core-error') { this.fail(new Error(msg.error)); return; }
    if (msg.type === 'core-collection-changed') {
      for (const listener of this.collectionListeners) listener(msg.collection);
      return;
    }

    // Unsolicited subscription update
    if (msg.type === 'subscription') {
      const cb = this.subscriptions.get(msg.subId);
      if (cb) cb(msg.data, msg.key);
      return;
    }

    // The worker's Gun, serving the page (OPEN-91 P6): a subscription event, or a peer answered.
    if (msg.type === 'gun-event') {
      this.gunEventListener?.(msg);
      return;
    }
    if (msg.type === 'gun-hi') {
      this.hubPeerSeen = true;
      for (const cb of this.peerListeners.splice(0)) cb();
      return;
    }

    // Worker signals it finished loading
    if (msg.type === 'ready') {
      if (!this.ready) {
        this.ready = true;
        this.resolveReady();
      }
      return;
    }

    // Response to a request
    const req = this.pending.get(msg.id);
    if (!req) return;
    clearTimeout(req.timer);
    this.pending.delete(msg.id);

    if (msg.err) req.reject(new Error(msg.err));
    else req.resolve(msg.data);
  }

  private sendRaw(type: string, payload?: any): Promise<any> {
    if (this.closed || !this.worker) return Promise.reject(new Error('Device core bridge is closed'));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Device core request timed out: ${type}`));
      }, 45_000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker!.postMessage({ id, type, payload }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  private async send(type: string, payload?: any): Promise<any> {
    // Lock/logout must erase recovery credentials immediately, even if the owner is restarting.
    if (type === 'logout') {
      this.credentialGeneration++;
      this.loginPair = this.authPair = null;
      this.subscriptionRequests.clear();
      this.subscriptions.clear();
    }
    if (type === 'gunRpc' && payload.op === 'leave') { this.credentialGeneration++; this.authPair = null; }
    const generation = this.credentialGeneration;
    if (this.recovery) await this.recovery;
    const answer = await this.sendRaw(type, payload);
    if (type === 'login' && generation === this.credentialGeneration && !this.closed) this.loginPair = payload.pair;
    if (type === 'logout') this.loginPair = null;
    if (type === 'gunRpc' && payload.op === 'auth' && answer.ok && generation === this.credentialGeneration && !this.closed) this.authPair = payload.pair;
    if (type === 'gunRpc' && payload.op === 'leave') this.authPair = null;
    return answer;
  }

  /** Wait for the worker to finish loading Gun.js before sending commands. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Initialize the Gun instance inside the worker. Must be called first. With `peer`, the worker's
   * Gun joins the hub and becomes the page's only Gun (OPEN-91 P6, see `gunTransport()`).
   */
  async init(options: { hubUrl?: string; peer?: boolean; isolated?: boolean } = {}): Promise<void> {
    if (this.closed) throw new Error('Device core bridge is closed');
    this.initOptions = options;
    if (!options.isolated && typeof navigator !== 'undefined' && navigator.locks && !this.clientLease) {
      this.clientLease = `iinpublic-core-client:${crypto.randomUUID()}`;
      // The page owns this lease, so the worker can discard its session even after a tab crash
      // (MessagePort has no reliable remote-close event). Never use a throttled heartbeat for it.
      await new Promise<void>((resolve, reject) => {
        void navigator.locks.request(this.clientLease!, async () => {
          await new Promise<void>((release) => { this.releaseLease = release; if (this.closed) release(); resolve(); });
        }).catch(reject);
      });
    }
    this.startWorker(options.isolated === true);
    await this.send('init', { ...options, clientLease: this.clientLease });
    await this.whenReady();
  }

  /* ── The device core (OPEN-91) ────────────────────────────────── */

  /** A request to the device core's app logic (src/core/protocol.ts). */
  core<R extends CoreRequest>(request: R): Promise<CoreResponse<R>> {
    return this.send('core', request);
  }

  onCoreCollectionChanged(listener: (collection: string) => void): () => void {
    this.collectionListeners.add(listener);
    return () => this.collectionListeners.delete(listener);
  }

  isClosed(): boolean { return this.closed; }

  /* ── The worker's Gun as the page's (OPEN-91 P6) ─────────────── */

  /** The page's Gun operations, run on the worker's (src/core/gun-rpc.ts). One session: the worker. */
  gunTransport(): GunRpcTransport {
    return {
      call: (body) => this.send('gunRpc', body),
      open: (onEvent, onClose) => {
        this.gunEventListener = onEvent;
        this.closeListeners.push(onClose);
        return Promise.resolve('worker');
      },
      onPeer: (cb) => {
        if (this.hubPeerSeen) cb();
        else this.peerListeners.push(cb);
      },
    };
  }

  /* ── Core graph operations ────────────────────────────────────── */

  put(path: string, data: any): Promise<void> {
    return this.send('put', { path, data });
  }

  get(path: string): Promise<any> {
    return this.send('get', { path });
  }

  /**
   * Subscribe to real-time updates at `path`.
   * Returns an unsubscribe function.
   */
  subscribe(path: string, callback: (data: any, key?: string) => void): () => void {
    const subId = `sub_${this.nextSubId++}`;
    this.subscriptions.set(subId, callback);
    this.subscriptionRequests.set(subId, { type: 'subscribe', payload: { subId, path } });
    void this.send('subscribe', { subId, path }).catch(() => undefined);
    return () => {
      this.subscriptions.delete(subId);
      this.subscriptionRequests.delete(subId);
      void this.send('unsubscribe', { subId }).catch(() => undefined);
    };
  }

  /* ── Identity (SEA) ───────────────────────────────────────────── */

  /** Generate a new cryptographic keypair and set it as the current user. */
  async createAccount(): Promise<{ pub: string; epub: string }> {
    return this.send('createAccount');
  }

  /** Restore a session from a previously generated/stored keypair. */
  async login(pair: GunPair): Promise<{ pub: string; epub: string }> {
    return this.send('login', { pair });
  }

  /** Clear the current user session. */
  logout(): Promise<void> {
    return this.send('logout');
  }

  /* ── User-space data ──────────────────────────────────────────── */

  /** Write to the current user's public namespace (readable by anyone). */
  putPublic(key: string, data: any): Promise<void> {
    return this.send('putPublic', { key, data });
  }

  /** Write to the current user's private namespace (AES-encrypted). */
  putPrivate(key: string, data: any): Promise<void> {
    return this.send('putPrivate', { key, data });
  }

  /** Read and decrypt from the current user's private namespace. */
  /** Every private record key the worker holds (for copying them to the app's node). */
  privateKeys(): Promise<string[]> {
    return this.send('privateKeys', {});
  }

  getPrivate(key: string): Promise<any> {
    return this.send('getPrivate', { key });
  }

  /** Subscribe to decrypted updates in the current user's local private namespace. */
  subscribePrivate(key: string, callback: (data: any) => void): () => void {
    const subId = `sub_${this.nextSubId++}`;
    this.subscriptions.set(subId, callback);
    this.subscriptionRequests.set(subId, { type: 'subscribePrivate', payload: { subId, key } });
    void this.send('subscribePrivate', { subId, key }).catch(() => undefined);
    return () => {
      this.subscriptions.delete(subId);
      this.subscriptionRequests.delete(subId);
      void this.send('unsubscribe', { subId }).catch(() => undefined);
    };
  }

  /* ── Flexible Graph schema ────────────────────────────────────── */

  /** Create a named node in the shared graph. */
  createNode(nodeId: string, nodeData: Record<string, any>): Promise<{ nodeId: string }> {
    return this.send('createNode', { nodeId, nodeData });
  }

  /**
   * Create a directed edge between two nodes.
   * Stored at: edges/<fromId>/<edgeLabel>/<toId>
   */
  linkNodes(fromId: string, toId: string, edgeLabel = 'link'): Promise<void> {
    return this.send('linkNodes', { fromId, toId, edgeLabel });
  }

  /** Terminate the worker. */
  terminate(): void {
    if (this.closed) return;
    this.closed = true;
    this.credentialGeneration++;
    try { this.worker?.postMessage({ type: 'disconnect' }); } catch { /* already disconnected */ }
    if (this.sharedWorker) this.sharedWorker.port.close();
    else (this.worker as Worker | null)?.terminate();
    this.worker = null;
    this.sharedWorker = null;
    this.loginPair = this.authPair = null;
    this.releaseLease?.();
    this.subscriptions.clear();
    this.subscriptionRequests.clear();
    this.fail(new Error('Device core bridge closed'));
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
  }
}
