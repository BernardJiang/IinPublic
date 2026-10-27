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
};

export class GunBridge {
  private worker: Worker;
  private pending = new Map<number, PendingRequest>();
  private subscriptions = new Map<string, (data: any, key?: string) => void>();
  private gunEventListener: ((event: { sub: string; data: unknown; key: string }) => void) | null = null;
  private readonly peerListeners: Array<() => void> = [];
  private readonly closeListeners: Array<() => void> = [];
  private hubPeerSeen = false;
  private nextId = 1;
  private nextSubId = 1;
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (reason: any) => void;

  constructor(workerUrl: string = '/core-worker.js') {
    this.readyPromise = new Promise<void>((res, rej) => {
      this.resolveReady = res;
      this.rejectReady = rej;
    });

    this.worker = new Worker(workerUrl);
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = (err) => {
      const msg = (err as ErrorEvent).message || 'Worker failed to load';
      console.error('[GunBridge] Worker error:', msg);
      // Reject every pending request so callers don't hang indefinitely.
      this.pending.forEach((req) => req.reject(new Error(`Worker error: ${msg}`)));
      this.pending.clear();
      if (!this.ready) this.rejectReady(new Error(`Worker error: ${msg}`));
      for (const cb of this.closeListeners.splice(0)) cb();
    };
  }

  private handleMessage(event: MessageEvent): void {
    const msg = event.data;

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
    this.pending.delete(msg.id);

    if (msg.err) req.reject(new Error(msg.err));
    else req.resolve(msg.data);
  }

  private send(type: string, payload?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  /** Wait for the worker to finish loading Gun.js before sending commands. */
  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * Initialize the Gun instance inside the worker. Must be called first. With `peer`, the worker's
   * Gun joins the hub and becomes the page's only Gun (OPEN-91 P6, see `gunTransport()`).
   */
  async init(options?: { hubUrl?: string; peer?: boolean }): Promise<void> {
    await this.send('init', options);
    await this.whenReady();
  }

  /* ── The device core (OPEN-91) ────────────────────────────────── */

  /** A request to the device core's app logic (src/core/protocol.ts). */
  core<R extends CoreRequest>(request: R): Promise<CoreResponse<R>> {
    return this.send('core', request);
  }

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
    this.send('subscribe', { subId, path });
    return () => {
      this.subscriptions.delete(subId);
      this.send('unsubscribe', { subId });
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
    this.send('subscribePrivate', { subId, key });
    return () => {
      this.subscriptions.delete(subId);
      this.send('unsubscribe', { subId });
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
    this.worker.terminate();
  }
}
