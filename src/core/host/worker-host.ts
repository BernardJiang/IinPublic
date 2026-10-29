/**
 * The device core's web host (OPEN-91): a Web Worker that runs the device's Gun instance — persisted
 * to IndexedDB — and the core logic in `src/core/`, serving the page over `postMessage`. Since P6 it
 * is the page's only Gun: it peers with the hub (behind the sharing policy) and runs the page's Gun
 * operations (`type: 'gunRpc'`, src/core/gun-rpc.ts), answering subscriptions as `type: 'gun-event'`.
 * Replaces the hand-written `public/worker.js`, keeping its message types for `GunBridge`
 * (`{ id, type, payload }` in, `{ id, err, data }` and `{ type: 'subscription', … }` out) and adding
 * `type: 'core'` for core requests. The native host will run the same core in Node.js.
 *
 * Loaded via `new Worker('/core-worker.js')` (webpack entry `core-worker`).
 */
import { gunGraphStore } from '../graph-store';
import { createCoreHandler } from '../core-handler';
import type { CoreRequest } from '../protocol';
import { closeGunRpcSession, createGunRpcSession, runGunRpc } from '../gun-rpc';
import { cancelSharingRead } from '../sharing-interests';
import { installSharingPolicy } from '../sharing-policy';
import { coordinateWorker } from './worker-coordinator';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function importScripts(...urls: string[]): void;
const scope = self as any;

/* ── 1. Load Gun + SEA ──────────────────────────────────────────────────────
 * gun.js registers window.Gun only when `window` exists; in a worker alias it to `self` first, or
 * sea.js falls into its require('./gun') path and throws. Gun's IndexedDB persistence is the
 * radix → radisk → store plugin chain (order matters); without it `store:` is silently ignored and
 * nothing is persisted (found by e2e 37-hard-crash-recovery). */
if (typeof scope.window === 'undefined') scope.window = scope;
importScripts('/node_modules/gun/gun.js');
importScripts('/node_modules/gun/lib/radix.js');
importScripts('/node_modules/gun/lib/radisk.js');
importScripts('/node_modules/gun/lib/store.js');
importScripts('/node_modules/gun/sea.js');
const Gun = scope.Gun;
const SEA = scope.SEA;

/* ── 2. IndexedDB persistence ─────────────────────────────────────────────── */
const IDB_NAME = 'gun-idb';
const IDB_STORE = 'nodes';
let database: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => { database = request.result; resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

const idbAdapter = {
  put(key: string, data: unknown, cb: (err: unknown, data?: unknown) => void): void {
    openDatabase().then((db) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, key);
      // `ok` is a flag: radisk passes it up into Gun's ack, which goes to the peer that wrote.
      tx.oncomplete = () => cb(null, 1);
      tx.onerror = () => cb(tx.error);
    }).catch((err) => cb(err));
  },
  get(key: string, cb: (err: unknown, data?: unknown) => void): void {
    openDatabase().then((db) => {
      const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      request.onsuccess = () => cb(null, request.result !== undefined ? request.result : null);
      request.onerror = () => cb(request.error);
    }).catch((err) => cb(err));
  },
};

/* ── 3. The device's Gun ──────────────────────────────────────────────────────
 * Peered with the hub when the page asks (`init` with `peer`), peerless otherwise (on native, where
 * this worker only hands its old data to the app's node). Either way the sharing policy keeps the
 * private namespaces on the device (docs/design/data-sharing-privacy-rules.md); it must be on Gun's
 * create hook before the instance exists. `radisk: false` must NOT be set — store.js's create hook
 * no-ops on it. */
let gun: any = null;
let handleCore: ((request: CoreRequest) => Promise<unknown>) | null = null;
installSharingPolicy(Gun);

let initialized: Promise<void> | null = null;
let hubPeerSeen = false;
function initGun(options: { hubUrl?: string; peer?: boolean } = {}): Promise<void> {
  if (initialized) {
    if (options.peer && options.hubUrl) gun.opt({ peers: [options.hubUrl], sharingRelayPeers: [options.hubUrl] });
    return initialized;
  }
  const peers = options.peer && options.hubUrl ? [options.hubUrl] : [];
  gun = Gun({ peers, sharingRelayPeers: peers, localStorage: false, store: idbAdapter, axe: false, multicast: false });
  gun.on('hi', () => {
    hubPeerSeen = true;
    for (const client of clients.values()) client.emit({ type: 'gun-hi' });
  });
  // Ready once storage is open: the GUI's first read (the exchange log at start-up) must find the
  // device's data, not an empty graph that has not loaded yet. An empty store means a new device.
  initialized = openDatabase()
    .then((db) => new Promise<boolean>((resolve) => {
      const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).count();
      request.onsuccess = () => resolve(request.result === 0);
      request.onerror = () => resolve(false);
    }))
    .catch(() => false)
    .then((freshDevice) => {
      handleCore = createCoreHandler(gunGraphStore(gun), { freshDevice, allowTestOverrides: process.env.DISABLE_HMR === 'true' });
    });
  return initialized;
}

/* ── 4. Session and subscriptions ─────────────────────────────────────────── */
type Client = {
  currentUser: { pair: any } | null;
  generation: number;
  leaseAbort?: AbortController;
  subscriptions: Map<string, any>;
  rpc: ReturnType<typeof createGunRpcSession>;
  emit: (message: any) => void;
};
const clients = new Map<string, Client>();
let ownerPub: string | null = null;
let authenticating = false;
let authQueue: Promise<unknown> = Promise.resolve();
function releaseUnusedIdentity(): void {
  if (!authenticating && ![...clients.values()].some((client) => client.currentUser)) {
    gun?.user().leave?.();
    ownerPub = null;
  }
}
function acceptIdentity(pair: any): void {
  if (!pair?.pub) throw new Error('identity required');
  if (ownerPub && ownerPub !== pair.pub) throw new Error('Another identity owns this device core; close its tabs before switching identity');
  ownerPub = pair.pub;
}
function disconnect(clientId: string): void {
  const client = clients.get(clientId);
  if (!client) return;
  client.generation++;
  client.leaseAbort?.abort();
  client.currentUser = null;
  closeGunRpcSession(client.rpc);
  for (const subscription of client.subscriptions.values()) subscription.off?.();
  clients.delete(clientId);
  releaseUnusedIdentity();
}

function pathRef(path: string): any {
  const parts = path.split('/').filter(Boolean);
  let ref = gun.get(parts[0]);
  for (let i = 1; i < parts.length; i++) ref = ref.get(parts[i]);
  return ref;
}

function subscribePath(path: string, listener: (data: any, key: string) => void): { off(): void } {
  let active = true;
  let event: any;
  const onData = (data: any, key: string, _message: any, subscription: any) => {
    event = subscription;
    if (active) listener(data, key);
    else event?.off?.();
  };
  pathRef(path).on(onData);
  return { off: () => { active = false; cancelSharingRead(gun, onData); event?.off?.(); } };
}

function gunPut(path: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // A peerless instance has the write the moment .put() runs; a missing ack is not a failure.
    const timeout = setTimeout(() => resolve({ ok: true, timedOut: true }), 8000);
    pathRef(path).put(data, (ack: any) => {
      clearTimeout(timeout);
      if (ack.err) reject(new Error(ack.err));
      else resolve(ack);
    });
  });
}

function gunGet(path: string): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 6000);
    pathRef(path).once((data: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(data !== undefined ? data : null);
    });
  });
}

/* Each tab has independent request IDs, subscriptions and private-record login state. */
coordinateWorker(scope, { disconnect, async receive(clientId, message, emit) {
  let client = clients.get(clientId);
  if (!client) {
    client = { currentUser: null, generation: 0, subscriptions: new Map(), rpc: createGunRpcSession((event) => emit({ type: 'gun-event', ...event })), emit };
    clients.set(clientId, client);
  }
  const { subscriptions } = client;
  const reply = (id: number, err: string | null, data: unknown): void => emit({ id, err, data: data ?? null });
  const { id, type, payload } = message || {};
  try {
    if (type !== 'init') await initGun();
    switch (type) {
      case 'init':
        if (!client.leaseAbort && typeof payload?.clientLease === 'string' && scope.navigator?.locks) {
          client.leaseAbort = new AbortController();
          void scope.navigator.locks.request(payload.clientLease, { signal: client.leaseAbort.signal }, () => disconnect(clientId)).catch(() => {});
        }
        await initGun(payload || {});
        emit({ type: 'ready' });
        if (hubPeerSeen) emit({ type: 'gun-hi' });
        reply(id, null, { ok: true });
        break;
      case 'gunRpc': {
        if (payload.op === 'auth') {
          const session = client;
          const generation = session.generation;
          const operation = authQueue.catch(() => {}).then(async () => {
            if (generation !== session.generation) throw new Error('Login cancelled');
            acceptIdentity(payload.pair);
            authenticating = true;
            try {
              const result = await runGunRpc(gun, payload, session.rpc);
              if (generation !== session.generation) throw new Error('Login cancelled');
              if (result.ok) session.currentUser = { pair: payload.pair };
              return result;
            } finally { authenticating = false; releaseUnusedIdentity(); }
          });
          authQueue = operation;
          const result = await operation;
          reply(id, null, result);
        } else if (payload.op === 'leave') {
          client.generation++;
          client.currentUser = null;
          closeGunRpcSession(client.rpc);
          releaseUnusedIdentity();
          reply(id, null, { ok: true });
        } else {
          if (payload.path?.[0] === '~user' && !client.currentUser) throw new Error('Not logged in');
          reply(id, null, await runGunRpc(gun, payload, client.rpc));
        }
        break;
      }
      case 'core':
        if (!handleCore) throw new Error('device core not ready');
        reply(id, null, await handleCore(payload as CoreRequest));
        break;
      case 'put':
        await gunPut(payload.path, payload.data);
        reply(id, null, { ok: true });
        break;
      case 'get':
        reply(id, null, await gunGet(payload.path));
        break;
      case 'subscribe': {
        subscriptions.get(payload.subId)?.off();
        const handler = subscribePath(payload.path, (data: unknown, key: string) => {
          emit({ type: 'subscription', subId: payload.subId, data, key });
        });
        subscriptions.set(payload.subId, handler);
        reply(id, null, { ok: true });
        break;
      }
      case 'unsubscribe': {
        const handler = subscriptions.get(payload.subId);
        if (handler && typeof handler.off === 'function') handler.off();
        subscriptions.delete(payload.subId);
        reply(id, null, { ok: true });
        break;
      }
      case 'createAccount': {
        const pair = await SEA.pair();
        acceptIdentity(pair);
        client.currentUser = { pair };
        reply(id, null, { pub: pair.pub, epub: pair.epub });
        break;
      }
      case 'login':
        acceptIdentity(payload.pair);
        client.currentUser = { pair: payload.pair };
        reply(id, null, { pub: payload.pair.pub, epub: payload.pair.epub });
        break;
      case 'logout':
        client.generation++;
        client.currentUser = null;
        for (const subscription of subscriptions.values()) subscription.off?.();
        subscriptions.clear();
        releaseUnusedIdentity();
        reply(id, null, { ok: true });
        break;
      case 'putPublic':
        if (!client.currentUser) { reply(id, 'Not logged in', null); break; }
        await gunPut(`users/${client.currentUser.pair.pub}/public/${payload.key}`, payload.data);
        reply(id, null, { ok: true });
        break;
      case 'putPrivate': {
        if (!client.currentUser) { reply(id, 'Not logged in', null); break; }
        const user = client.currentUser;
        const encrypted = await SEA.encrypt(JSON.stringify(payload.data), user.pair);
        if (client.currentUser !== user) throw new Error('Login cancelled');
        await gunPut(`users/${user.pair.pub}/private/${payload.key}`, encrypted);
        reply(id, null, { ok: true });
        break;
      }
      case 'getPrivate': {
        if (!client.currentUser) { reply(id, 'Not logged in', null); break; }
        const user = client.currentUser;
        const raw = await gunGet(`users/${user.pair.pub}/private/${payload.key}`);
        if (!raw) { reply(id, null, null); break; }
        const decrypted = await SEA.decrypt(raw, user.pair);
        if (client.currentUser !== user) throw new Error('Login cancelled');
        if (!decrypted) { reply(id, null, null); break; }
        reply(id, null, typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted);
        break;
      }
      case 'privateKeys': {
        // Every private record key this worker holds (to copy them to the app's node, OPEN-91 P5).
        // A key with '/' is stored as nested nodes: walk them; a string field is an encrypted record.
        if (!client.currentUser) { reply(id, 'Not logged in', null); break; }
        const root = `users/${client.currentUser.pair.pub}/private`;
        const keys: string[] = [];
        const walk = async (prefix: string, depth: number): Promise<void> => {
          if (depth > 8) return;
          const node = await gunGet(prefix ? `${root}/${prefix}` : root) as Record<string, unknown> | null;
          if (!node || typeof node !== 'object') return;
          for (const [key, value] of Object.entries(node)) {
            if (key === '_' || value === null || value === undefined) continue;
            const path = prefix ? `${prefix}/${key}` : key;
            if (typeof value === 'string') keys.push(path);
            else if (typeof value === 'object' && (value as Record<string, unknown>)['#']) await walk(path, depth + 1);
          }
        };
        await walk('', 0);
        reply(id, null, keys);
        break;
      }
      case 'subscribePrivate': {
        if (!client.currentUser) { reply(id, 'Not logged in', null); break; }
        const user = client.currentUser;
        subscriptions.get(payload.subId)?.off();
        const handler = subscribePath(`users/${user.pair.pub}/private/${payload.key}`, async (raw: unknown) => {
          if (!raw) return;
          try {
            const decrypted = await SEA.decrypt(raw, user.pair);
            if (!decrypted) return;
            if (client.currentUser !== user || !clients.has(clientId)) return;
            emit({ type: 'subscription', subId: payload.subId, data: typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted });
          } catch {
            // A corrupt local record is skipped; a later valid update remains subscribed.
          }
        });
        subscriptions.set(payload.subId, handler);
        reply(id, null, { ok: true });
        break;
      }
      case 'createNode':
        await gunPut(`nodes/${payload.nodeId}`, { ...payload.nodeData, id: payload.nodeId, createdAt: Date.now() });
        reply(id, null, { ok: true, nodeId: payload.nodeId });
        break;
      case 'linkNodes': {
        const label = payload.edgeLabel || 'link';
        await gunPut(`edges/${payload.fromId}/${label}/${payload.toId}`, { from: payload.fromId, to: payload.toId, label, at: Date.now() });
        reply(id, null, { ok: true });
        break;
      }
      default:
        reply(id, `Unknown message type: ${type}`, null);
    }
  } catch (err) {
    reply(id, err && (err as Error).message ? (err as Error).message : String(err), null);
  }
} });
